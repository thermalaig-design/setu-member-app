-- page_tracking_rpc: treat the legacy platform name 'setu_member_app' as 'app'.
--
-- Why: older app builds still send platform = 'setu_member_app'. They found no
-- such rows after the rename, so route_add re-created every route under the old
-- name. With this change, route_view / route_add / route_edit map the legacy
-- name to 'app' first, so old builds read the real rows and never create
-- duplicates, and their activity lands on the correct page_id.
--
-- Differences from the previous definition (everything else is unchanged):
--   1. v_platform: normalised platform (legacy name -> 'app').
--   2. route_view filters on v_platform.
--   3. route_add inserts v_platform and uses ON CONFLICT DO NOTHING; when the
--      route already exists it returns the existing row instead of an error.
--   4. route_edit also normalises platform when it is being changed.
--
-- Run this whole file once in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.page_tracking_rpc(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_result      jsonb;
    v_id          uuid;
    v_count       integer;
    v_limit       integer := 100;
    v_offset      integer := 0;
    v_constraint  text;
    v_platform    text;
BEGIN
    IF p_action IS NULL OR btrim(p_action) = '' THEN
        RAISE EXCEPTION 'p_action is required';
    END IF;

    v_platform := CASE
        WHEN lower(btrim(COALESCE(p_payload->>'platform', ''))) = 'setu_member_app' THEN 'app'
        ELSE p_payload->>'platform'
    END;

    CASE lower(p_action)

        WHEN 'route_view' THEN
            SELECT COALESCE(
                jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),
                '[]'::jsonb
            )
            INTO v_result
            FROM (
                SELECT
                    pr.id,
                    pr.platform,
                    pr.name,
                    pr.route,
                    pr.module,
                    pr.is_active,
                    pr.created_at,
                    pr.updated_at
                FROM public.page_routes pr
                WHERE
                    (
                        NULLIF(v_platform, '') IS NULL
                        OR pr.platform = v_platform
                    )
                    AND (
                        NULLIF(p_payload->>'module', '') IS NULL
                        OR pr.module = p_payload->>'module'
                    )
                    AND (
                        NOT (p_payload ? 'is_active')
                        OR pr.is_active = (p_payload->>'is_active')::boolean
                    )
            ) x;

            RETURN jsonb_build_object(
                'success', true,
                'data', v_result
            );

        WHEN 'route_add' THEN
            IF NULLIF(btrim(p_payload->>'platform'), '') IS NULL
               OR NULLIF(btrim(p_payload->>'name'), '') IS NULL
               OR NULLIF(btrim(p_payload->>'route'), '') IS NULL
               OR NULLIF(btrim(p_payload->>'module'), '') IS NULL THEN
                RAISE EXCEPTION 'platform, name, route and module are required';
            END IF;

            INSERT INTO public.page_routes (
                platform,
                name,
                route,
                module,
                is_active
            )
            VALUES (
                v_platform,
                p_payload->>'name',
                p_payload->>'route',
                p_payload->>'module',
                COALESCE((p_payload->>'is_active')::boolean, true)
            )
            ON CONFLICT DO NOTHING
            RETURNING id INTO v_id;

            IF v_id IS NULL THEN
                -- Route already registered: return the existing row, add nothing.
                SELECT pr.id
                INTO v_id
                FROM public.page_routes pr
                WHERE pr.platform = v_platform
                  AND pr.route = p_payload->>'route'
                LIMIT 1;

                SELECT to_jsonb(pr)
                INTO v_result
                FROM public.page_routes pr
                WHERE pr.id = v_id;

                RETURN jsonb_build_object(
                    'success', true,
                    'message', 'Route already exists',
                    'data', v_result
                );
            END IF;

            SELECT to_jsonb(pr)
            INTO v_result
            FROM public.page_routes pr
            WHERE pr.id = v_id;

            RETURN jsonb_build_object(
                'success', true,
                'message', 'Route added successfully',
                'data', v_result
            );

        WHEN 'route_edit' THEN
            v_id := NULLIF(p_payload->>'id', '')::uuid;

            IF v_id IS NULL THEN
                RAISE EXCEPTION 'id is required';
            END IF;

            UPDATE public.page_routes
            SET
                platform = CASE
                    WHEN p_payload ? 'platform' THEN v_platform
                    ELSE platform
                END,
                name = CASE
                    WHEN p_payload ? 'name' THEN p_payload->>'name'
                    ELSE name
                END,
                route = CASE
                    WHEN p_payload ? 'route' THEN p_payload->>'route'
                    ELSE route
                END,
                module = CASE
                    WHEN p_payload ? 'module' THEN p_payload->>'module'
                    ELSE module
                END,
                is_active = CASE
                    WHEN p_payload ? 'is_active' THEN (p_payload->>'is_active')::boolean
                    ELSE is_active
                END,
                updated_at = now()
            WHERE id = v_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Route not found for id %', v_id;
            END IF;

            SELECT to_jsonb(pr)
            INTO v_result
            FROM public.page_routes pr
            WHERE pr.id = v_id;

            RETURN jsonb_build_object(
                'success', true,
                'message', 'Route updated successfully',
                'data', v_result
            );

        WHEN 'route_delete' THEN
            v_id := NULLIF(p_payload->>'id', '')::uuid;

            IF v_id IS NULL THEN
                RAISE EXCEPTION 'id is required';
            END IF;

            UPDATE public.page_routes
            SET
                is_active = false,
                updated_at = now()
            WHERE id = v_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Route not found for id %', v_id;
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'message', 'Route deactivated successfully',
                'id', v_id
            );

        WHEN 'activity_add' THEN
            IF jsonb_typeof(p_payload->'events') IS DISTINCT FROM 'array' THEN
                RAISE EXCEPTION 'events must be a JSON array';
            END IF;

            IF jsonb_array_length(p_payload->'events') = 0 THEN
                RAISE EXCEPTION 'events array cannot be empty';
            END IF;

            IF EXISTS (
                SELECT 1
                FROM jsonb_array_elements(p_payload->'events') AS e
                WHERE NULLIF(e->>'members_id', '') IS NOT NULL
                  AND NULLIF(e->>'user_reg_id', '') IS NOT NULL
            ) THEN
                RAISE EXCEPTION 'An activity event cannot contain both members_id and user_reg_id';
            END IF;

            INSERT INTO public.page_activity (
                page_id,
                members_id,
                user_reg_id,
                trust_id,
                metadata
            )
            SELECT
                NULLIF(event->>'page_id', '')::uuid,
                NULLIF(event->>'members_id', '')::uuid,
                NULLIF(event->>'user_reg_id', '')::uuid,
                NULLIF(event->>'trust_id', '')::uuid,
                COALESCE(event->'metadata', '{}'::jsonb)
            FROM jsonb_array_elements(p_payload->'events') AS event;

            GET DIAGNOSTICS v_count = ROW_COUNT;

            RETURN jsonb_build_object(
                'success', true,
                'message', 'Page activity added successfully',
                'inserted_count', v_count
            );

        WHEN 'activity_view' THEN
            v_limit := LEAST(
                GREATEST(
                    COALESCE(NULLIF(p_payload->>'limit', '')::integer, 100),
                    1
                ),
                500
            );

            v_offset := GREATEST(
                COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0),
                0
            );

            SELECT COALESCE(
                jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),
                '[]'::jsonb
            )
            INTO v_result
            FROM (
                SELECT
                    pa.id,
                    pa.page_id,
                    pa.members_id,
                    pa.user_reg_id,
                    pa.trust_id,
                    pa.metadata,
                    pa.created_at,
                    pa.updated_at,
                    pr.platform,
                    pr.name AS page_name,
                    pr.route,
                    pr.module
                FROM public.page_activity pa
                INNER JOIN public.page_routes pr
                    ON pr.id = pa.page_id
                WHERE
                    (
                        NULLIF(p_payload->>'members_id', '') IS NULL
                        OR pa.members_id = (p_payload->>'members_id')::uuid
                    )
                    AND (
                        NULLIF(p_payload->>'user_reg_id', '') IS NULL
                        OR pa.user_reg_id = (p_payload->>'user_reg_id')::uuid
                    )
                    AND (
                        NULLIF(p_payload->>'trust_id', '') IS NULL
                        OR pa.trust_id = (p_payload->>'trust_id')::uuid
                    )
                    AND (
                        NULLIF(p_payload->>'page_id', '') IS NULL
                        OR pa.page_id = (p_payload->>'page_id')::uuid
                    )
                    AND (
                        NULLIF(p_payload->>'from_date', '') IS NULL
                        OR pa.created_at >= (p_payload->>'from_date')::timestamptz
                    )
                    AND (
                        NULLIF(p_payload->>'to_date', '') IS NULL
                        OR pa.created_at <= (p_payload->>'to_date')::timestamptz
                    )
                ORDER BY pa.created_at DESC
                LIMIT v_limit
                OFFSET v_offset
            ) x;

            RETURN jsonb_build_object(
                'success', true,
                'data', v_result,
                'limit', v_limit,
                'offset', v_offset
            );

        WHEN 'up_activity_view' THEN
            -- trust_id remains mandatory
            IF NULLIF(p_payload->>'trust_id', '') IS NULL THEN
                RAISE EXCEPTION 'trust_id is required';
            END IF;

            -- user_reg_id is intentionally optional

            v_limit := LEAST(
                GREATEST(
                    COALESCE(NULLIF(p_payload->>'limit', '')::integer, 100),
                    1
                ),
                500
            );

            v_offset := GREATEST(
                COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0),
                0
            );

            SELECT COALESCE(
                jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),
                '[]'::jsonb
            )
            INTO v_result
            FROM (
                SELECT
                    pa.id,
                    pa.page_id,
                    pa.members_id,
                    pa.user_reg_id,
                    pa.trust_id,
                    pa.metadata,
                    pa.created_at,
                    pa.updated_at,
                    pr.platform,
                    pr.name AS page_name,
                    pr.route,
                    pr.module
                FROM public.page_activity pa
                INNER JOIN public.page_routes pr
                    ON pr.id = pa.page_id
                WHERE pa.trust_id = (p_payload->>'trust_id')::uuid
                  AND (
                      NULLIF(p_payload->>'user_reg_id', '') IS NULL
                      OR pa.user_reg_id = (p_payload->>'user_reg_id')::uuid
                  )
                  AND lower(btrim(pr.platform)) IN ('user panel', 'user_panel')
                ORDER BY pa.created_at DESC
                LIMIT v_limit
                OFFSET v_offset
            ) x;

            RETURN jsonb_build_object(
                'success', true,
                'data', v_result,
                'limit', v_limit,
                'offset', v_offset
            );

        ELSE
            RAISE EXCEPTION
                'Invalid p_action: %. Allowed actions: route_view, route_add, route_edit, route_delete, activity_add, activity_view, up_activity_view',
                p_action;
    END CASE;

EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid UUID or input format.'
        );

    WHEN unique_violation THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Duplicate record. Same platform and route may already exist.'
        );

    WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;

        RETURN jsonb_build_object(
            'success', false,
            'error', CASE v_constraint
                WHEN 'page_activity_page_fk'
                    THEN 'Invalid page_id: page does not exist in page_routes.'
                WHEN 'page_activity_member_fk'
                    THEN 'Invalid members_id: member does not exist in Members.'
                WHEN 'page_activity_user_reg_fk'
                    THEN 'Invalid user_reg_id: user does not exist in users_reg.'
                WHEN 'page_activity_trust_fk'
                    THEN 'Invalid trust_id: trust does not exist in Trust.'
                ELSE 'Foreign key validation failed: ' || COALESCE(v_constraint, 'unknown constraint')
            END
        );

    WHEN not_null_violation THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'A required value is missing.'
        );

    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$function$;


-- Cleanup of the duplicates already created (run AFTER the function above).
-- Keeps the original 'app' rows; moves any activity that landed on a duplicate
-- over to the original row, then removes the duplicates.
begin;

update public.page_activity pa
set page_id = a.id, updated_at = now()
from public.page_routes o
join public.page_routes a
  on a.route = o.route and a.platform = 'app'
where pa.page_id = o.id
  and o.platform = 'setu_member_app';

delete from public.page_routes o
using public.page_routes a
where o.platform = 'setu_member_app'
  and a.platform = 'app'
  and a.route = o.route;

commit;

-- Verify: should list only 'app' (45 with /sidebar) and 'user_panel' (51).
-- select platform, count(*) from public.page_routes group by platform;
