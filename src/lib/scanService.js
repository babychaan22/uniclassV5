
export async function scanAndResolve(hash, groupMemberId, risk = false, recipientType = "member") {
  if (!hash || (recipientType === "member" && !groupMemberId)) {
    return { error: "Select a member or the whole group before scanning." };
  }

  try {
    const { supabase } = await import('@/api/supabaseClient');
    const { data, error } = await supabase.rpc('scan_qr', {
      p_hash: hash,
      p_group_member_id: groupMemberId,
      p_risk: risk,
      p_recipient_type: recipientType,
    });
    if (error) throw error;
    return data;
  } catch (err) {
    return { error: err?.message || "Something went wrong resolving this scan." };
  }
}

export async function peekQrCode(hash) {
  try {
    const { supabase } = await import('@/api/supabaseClient');
    const { data, error } = await supabase.rpc('peek_qr_code', { p_hash: hash });
    if (error) throw error;
    return data;
  } catch (err) {
    return { error: err?.message || 'This QR code cannot be checked right now.' };
  }
}
