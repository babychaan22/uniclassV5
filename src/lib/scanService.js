
export async function scanAndResolve(hash, groupMemberId, risk = false) {
  const db = globalThis.__B44_DB__;
  if (!hash || !groupMemberId) {
    return { error: "Missing hash or member." };
  }

  try {
    const qrRes = await db.entities.QRCode.filter({ hash });
    const qr = qrRes[0];
    if (!qr || qr.is_used) {
      return { error: "This QR code has already been used or is invalid." };
    }

    const member = await db.entities.GroupMember.get(groupMemberId);
    if (!member) {
      return { error: "Member not found." };
    }

    let points = qr.base_points;
    let eventType = "scan";
    let multiplier = 1;
    let gacha = null;

    if (qr.qr_type === "gacha" && risk) {
      const { GACHA_OUTCOMES } = await import("./gacha");
      const drawIdx = Math.floor(Math.random() * GACHA_OUTCOMES.length);
      const draw = GACHA_OUTCOMES[drawIdx];
      multiplier = draw.mult;
      points = Math.round(qr.base_points * draw.mult);
      eventType =
        draw.mood === "sad" ? "gacha_loss" : draw.mood === "happy" ? "gacha_win" : "gacha_even";
      gacha = { mood: draw.mood, multiplier: draw.mult, index: drawIdx };
    }

    const fresh = await db.entities.QRCode.filter({ id: qr.id, is_used: false });
    if (fresh.length === 0) {
      return { error: "This QR code was just used — try another one." };
    }

    await db.entities.QRCode.update(qr.id, {
      is_used: true,
      used_by_member_id: groupMemberId,
      used_at: new Date().toISOString(),
    });

    const log = await db.entities.ParticipationLog.create({
      group_member_id: groupMemberId,
      group_id: member.group_id,
      classroom_id: qr.classroom_id,
      qr_code_id: qr.id,
      points_awarded: points,
      event_type: eventType,
      multiplier,
      note: qr.qr_type === "gacha" ? "Gacha capsule scan" : "QR scan",
    });

    return {
      points,
      eventType,
      multiplier,
      gacha,
      groupId: member.group_id,
      memberId: groupMemberId,
      log,
    };
  } catch (err) {
    return { error: err?.message || "Something went wrong resolving this scan." };
  }
}

