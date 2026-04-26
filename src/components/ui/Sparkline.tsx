import type { SVGProps } from 'react';
import { cn } from '@/lib/utils';

export interface SparklineProps extends Omit<SVGProps<SVGSVGElement>, 'points'> {
  /** Numeric data points. */
  points: number[];
  /** Width of the SVG viewport. Default 120. */
  width?: number;
  /** Height of the SVG viewport. Default 32. */
  height?: number;
  /** Stroke color override (otherwise uses --accent). */
  stroke?: string;
  /** Fill color for area under the line (otherwise uses --accent-soft). */
  fill?: string;
  /** Stroke width for the line. Default 1.5. */
  strokeWidth?: number;
}

/**
 * Sparkline — pure SVG line chart with filled area beneath.
 * No external dependencies, theme-aware via CSS variables.
 */
export function Sparkline({
  points,
  width = 120,
  height = 32,
  stroke,
  fill,
  strokeWidth = 1.5,
  className,
  ...rest
}: SparklineProps) {
  if (!points.length) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className={cn('block', className)}
        aria-hidden="true"
        {...rest}
      />
    );
  }

  // Single point: draw a flat line.
  const series = points.length === 1 ? [points[0]!, points[0]!] : points;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const pad = 2;

  const coords = series.map((v, i) => {
    const x = (i / (series.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - pad * 2) - pad;
    return [x, y] as const;
  });

  const linePath = coords
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');

  const areaPath = `${linePath} L${width.toFixed(2)} ${height.toFixed(
    2,
  )} L0 ${height.toFixed(2)} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={cn('block', className)}
      aria-hidden="true"
      {...rest}
    >
      <path
        d={areaPath}
        fill={fill ?? 'var(--accent-soft)'}
        opacity={0.7}
      />
      <path
        d={linePath}
        fill="none"
        stroke={stroke ?? 'var(--accent)'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default Sparkline;
