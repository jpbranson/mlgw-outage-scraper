import type { Plugin } from 'chart.js';

// ggplot2 theme_minimal: no panel fill/border or axis ticks, pale grey grids.
// Major grids are configured on the chart scales; minor grids are thinner.
export const ggplotMinimalGrid: Plugin<'line'> = {
  id: 'ggplot-minimal-grid',
  beforeDraw(chart) {
    const { ctx, chartArea: area } = chart;
    if (!area || area.width <= 0 || area.height <= 0) return;
    ctx.save();
    ctx.strokeStyle = '#EBEBEB';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const axis of ['x', 'y'] as const) {
      const scale = chart.scales[axis];
      for (let index = 1; index < scale.ticks.length; index++) {
        const pixel = (scale.getPixelForTick(index - 1) + scale.getPixelForTick(index)) / 2;
        if (axis === 'x' && pixel > area.left && pixel < area.right) {
          ctx.moveTo(pixel, area.top); ctx.lineTo(pixel, area.bottom);
        } else if (axis === 'y' && pixel > area.top && pixel < area.bottom) {
          ctx.moveTo(area.left, pixel); ctx.lineTo(area.right, pixel);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }
};
