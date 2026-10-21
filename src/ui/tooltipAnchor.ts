// ★BJ704-G7 件4（R5 登记债③清偿,2026-10-21）：光标锚槽位泡定位纯算单源——
// UI.cursorTooltipPos 的可测核（achTipAnchorXY(AchievementsUI.ts,BJ501)/
// Renderer.mouseTextAnchor 同族第三员,BJ669e 光标锚公式族）。
//
// 权威 = Main.MouseText(:20378-20392 光标锚) → MouseText_DrawItemTooltip
// (:20561-20579 文字原点+钳制):
//   文字原点 X = mouseX+14(:20378) +6(ThickMouse 默认档 :20385-20389,
//   MouseBorderColor :276 非透明 → :2684 恒开,本仓无该设置建模)
//   +34(光标持物 :20390-20392) +6(toolTipDistance :411 私有静态,【仅 :20561-20562
//   读】——item tooltip 支专属,MouseTextInner 纯文本支 :20403-20412 不吃)
//   +8(悬停文本框开 :20565);Y 同式(+2 :20566)。
//   钳制 = 文字缘 + num4(:20563 关档 4 / :20565-20570 开档 18)。
//
// 文字原点 → 元素缘换算（.sw-tooltip padding:9px 13px,UI.ts CSS）:
//   · opaque(盒开) = 盒几何 :20579(X−14/Y−9)——注意 .sw-tooltip 横 padding 13
//     ≠盒内文字距 14,DOM 文字恒比原版左 1px(清偿A-F2 已声明的 1px 差族,本刀不扩
//     不缩;纵向 ttd+2−9=−1 旧值 +20 → +19 与原版盒顶逐像素合位);
//   · nobox(盒关,背景 transparent 但 padding 仍在) = 无盒,元素框=文字+padding
//     → 元素缘 = 文字缘 −(13,9)——旧实现未建模 toolTipDistance:nobox 文字原点
//     恒偏右 ~7px/偏下 ~3px(R5 实测差,本刀修正)。
//   钳制换算:tw=文字宽+26/th=文字高+18 → 元素缘 pad = num4+文字距−盒内距系
//   (opaque (6,9) / nobox (−9,−5));元素缘 Math.max(0,·) 下限=既有防御保留
//   (原版可负,本仓 max-width:280px 使该角不可达)。
export function cursorTooltipAnchor(
  mouseX: number, mouseY: number, heldOnCursor: boolean, opaque: boolean,
  tw: number, th: number, screenW: number, screenH: number,
): { left: number; top: number } {
  // 文字原点(:20378-20392 + :20561-20566;toolTipDistance=第 4 个 +6)
  let tx = mouseX + 14 + 6 + (heldOnCursor ? 34 : 0) + 6 + (opaque ? 8 : 0);
  let ty = mouseY + 14 + 6 + 6 + (opaque ? 2 : 0);
  // 文字缘钳制 num4(:20563/:20565-20570);tw/th=元素量测 → 还原文字量测
  const num4 = opaque ? 18 : 4;
  const textW = tw - 26, textH = th - 18;
  if (tx + textW + num4 > screenW) tx = screenW - textW - num4;
  if (ty + textH + num4 > screenH) ty = screenH - textH - num4;
  // 文字原点 → 元素原点(opaque 盒几何 :20579 X−14/Y−9;nobox 纯 padding 13/9)
  return { left: Math.max(0, tx - (opaque ? 14 : 13)), top: Math.max(0, ty - 9) };
}
