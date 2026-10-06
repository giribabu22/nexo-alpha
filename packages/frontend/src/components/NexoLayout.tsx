import React, { type CSSProperties, type ReactNode } from "react";

/** A CSS length: a number is pixels. */
type Length = number | string;

const px = (value: Length): string => (typeof value === "number" ? `${value}px` : value);

export interface NexoStackProps {
  /** Default: "column" */
  readonly direction?: "row" | "column" | undefined;
  /** Space between children. Default: 16 */
  readonly gap?: Length | undefined;
  readonly align?: CSSProperties["alignItems"] | undefined;
  readonly justify?: CSSProperties["justifyContent"] | undefined;
  /** Let a row wrap onto several lines. Default: false */
  readonly wrap?: boolean | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
  readonly children?: ReactNode;
}

/** Lays children out in a column (or a row) with even spacing. */
export function NexoStack({
  direction = "column",
  gap = 16,
  align,
  justify,
  wrap = false,
  className,
  style,
  children
}: NexoStackProps): React.JSX.Element {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: direction,
        gap: px(gap),
        ...(align !== undefined ? { alignItems: align } : {}),
        ...(justify !== undefined ? { justifyContent: justify } : {}),
        ...(wrap ? { flexWrap: "wrap" } : {}),
        ...style
      }}
    >
      {children}
    </div>
  );
}

export interface NexoGridProps {
  /** A fixed number of equal columns. */
  readonly columns?: number | undefined;
  /** Responsive: as many columns as fit at this minimum width. Used when `columns` is not set. Default: 240 */
  readonly minColumnWidth?: Length | undefined;
  /** Default: 16 */
  readonly gap?: Length | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
  readonly children?: ReactNode;
}

/** Lays children out in a grid of equal columns. */
export function NexoGrid({ columns, minColumnWidth = 240, gap = 16, className, style, children }: NexoGridProps): React.JSX.Element {
  const template = columns !== undefined
    ? `repeat(${columns}, minmax(0, 1fr))`
    : `repeat(auto-fit, minmax(min(${px(minColumnWidth)}, 100%), 1fr))`;
  return (
    <div className={className} style={{ display: "grid", gridTemplateColumns: template, gap: px(gap), ...style }}>
      {children}
    </div>
  );
}
