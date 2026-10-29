import React from 'react';
import {
  OverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  composeRenderProps,
} from 'react-aria-components';

const tooltipClassName = (className) => {
  const classes = ['kuku-tooltip'];
  if (className) classes.push(className);
  return classes.join(' ');
};

export function Tooltip({ children, className, offset = 10, ...props }) {
  return (
    <AriaTooltip
      {...props}
      offset={offset}
      className={composeRenderProps(className, (resolved) =>
        tooltipClassName(resolved)
      )}
    >
      <OverlayArrow className="kuku-tooltip-arrow">
        <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
          <path d="M0 0 L4 4 L8 0" />
        </svg>
      </OverlayArrow>
      {children}
    </AriaTooltip>
  );
}

export function KukuTooltipTrigger({
  content,
  children,
  placement = 'top',
  delay = 350,
  closeDelay = 120,
  isDisabled = false,
  tooltipProps = {},
}) {
  if (!content) return children;

  return (
    <TooltipTrigger
      delay={delay}
      closeDelay={closeDelay}
      isDisabled={isDisabled}
    >
      {children}
      <Tooltip placement={placement} {...tooltipProps}>
        {content}
      </Tooltip>
    </TooltipTrigger>
  );
}
