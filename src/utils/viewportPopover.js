const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export const viewportPopoverPosition = ({
  anchor,
  viewportWidth,
  viewportHeight,
  width = 300,
  maxHeight = 340,
  margin = 8,
  gap = 6,
}) => {
  const screenWidth = Math.max(0, Number(viewportWidth) || 0);
  const screenHeight = Math.max(0, Number(viewportHeight) || 0);
  const horizontalMargin = Math.min(margin, screenWidth / 2);
  const verticalMargin = Math.min(margin, screenHeight / 2);
  const panelWidth = Math.min(width, Math.max(0, screenWidth - horizontalMargin * 2));
  const panelHeight = Math.min(maxHeight, Math.max(0, screenHeight - verticalMargin * 2));
  const left = clamp(anchor.left, horizontalMargin, screenWidth - horizontalMargin - panelWidth);
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - gap - panelHeight;
  const spaceBelow = screenHeight - verticalMargin - belowTop;
  const spaceAbove = anchor.top - verticalMargin - gap;
  const preferredTop =
    spaceBelow >= panelHeight || spaceBelow >= spaceAbove ? belowTop : aboveTop;
  const top = clamp(preferredTop, verticalMargin, screenHeight - verticalMargin - panelHeight);

  return { top, left, width: panelWidth, maxHeight: panelHeight };
};