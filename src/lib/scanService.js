
export async function scanAndResolve(hash, groupMemberId, risk = false) {
  if (!hash || !groupMemberId) {
    return { error: "Missing hash or member." };
  }

  try {
    const { supabase } = await import('@/api/supabaseClient');
    const { data, error } = await supabase.rpc('scan_qr', {
      p_hash: hash,
      p_group_member_id: groupMemberId,
      p_risk: risk,
    });
    if (error) throw error;
    return data;
  } catch (err) {
    return { error: err?.message || "Something went wrong resolving this scan." };
  }
}
