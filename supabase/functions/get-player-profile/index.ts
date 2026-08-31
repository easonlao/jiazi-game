import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CURRENT_REPLAY_RULES } from '../../../src/core/ReplayRules.ts';
import {
  getBalanceProfileById,
  getDefaultBalanceProfileForRules,
  EA_DEFAULT_BALANCE_PROFILE,
} from '../../../src/core/BalanceProfile.ts';
import {
  assignPlayerToExperiment,
  getActiveExperimentForRules,
  validateExperimentConfig,
} from '../../../src/core/ExperimentAssignment.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'server_misconfigured' }, 500);

  const token = extractBearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return json({ error: 'unauthorized' }, 401);

  const { data: link, error: linkError } = await supabase
    .from('player_identity_links')
    .select('player_id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (linkError) return json({ error: 'internal_error' }, 500);
  if (!link) return json({ error: 'identity_not_ready' }, 403);

  const targetRulesVersion = CURRENT_REPLAY_RULES.rulesVersion;
  let balanceProfileId = (getDefaultBalanceProfileForRules(targetRulesVersion) ?? EA_DEFAULT_BALANCE_PROFILE).profileId;
  let experimentId: string | null = null;
  let variantId: string | null = null;

  const activeExperiment = getActiveExperimentForRules(targetRulesVersion);
  if (activeExperiment && activeExperiment.enabled) {
    const expValidation = validateExperimentConfig(activeExperiment);
    if (!expValidation.valid) {
      console.error('Active experiment misconfigured:', expValidation.errors);
      return json({ error: 'server_misconfigured' }, 500);
    }

    const { data: persistentAssignment, error: persistentError } = await supabase
      .from('player_experiment_assignments')
      .select('variant_id, balance_profile_id')
      .eq('player_id', link.player_id)
      .eq('experiment_id', activeExperiment.id)
      .maybeSingle();

    if (persistentError) return json({ error: 'internal_error' }, 500);

    if (persistentAssignment) {
      if (!persistentAssignment.variant_id || !persistentAssignment.balance_profile_id) {
        console.error('Persisted assignment missing fields:', persistentAssignment);
        return json({ error: 'server_misconfigured' }, 500);
      }
      const matchedVariant = activeExperiment.variants.find((v) => v.variantId === persistentAssignment.variant_id);
      if (!matchedVariant || matchedVariant.balanceProfileId !== persistentAssignment.balance_profile_id) {
        console.error('Persisted assignment variant inconsistent with active experiment variants:', persistentAssignment);
        return json({ error: 'server_misconfigured' }, 500);
      }
      const persistedProfile = getBalanceProfileById(persistentAssignment.balance_profile_id);
      if (!persistedProfile || persistedProfile.rulesVersion !== targetRulesVersion) {
        console.error('Persisted assignment profile invalid or rules mismatch:', persistentAssignment);
        return json({ error: 'server_misconfigured' }, 500);
      }
      balanceProfileId = persistedProfile.profileId;
      experimentId = activeExperiment.id;
      variantId = matchedVariant.variantId;
    }

    if (!experimentId) {
      const assignment = assignPlayerToExperiment(link.player_id, activeExperiment);
      balanceProfileId = assignment.profile.profileId;
      experimentId = assignment.experimentId;
      variantId = assignment.variantId;

      if (experimentId && variantId) {
        const { error: upsertError } = await supabase.from('player_experiment_assignments').upsert({
          player_id: link.player_id,
          experiment_id: experimentId,
          variant_id: variantId,
          balance_profile_id: balanceProfileId,
          assigned_at: new Date().toISOString(),
        });
        if (upsertError) {
          console.error('Failed to persist player experiment assignment', upsertError);
          return json({ error: 'internal_error' }, 500);
        }
      }
    }
  }

  return json({
    player_id: link.player_id,
    rules_version: targetRulesVersion,
    balance_profile_id: balanceProfileId,
    experiment_id: experimentId,
    variant_id: variantId,
  });
});

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
