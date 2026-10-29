import React, {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Button as AriaButton,
  Dialog,
  FieldError as AriaFieldError,
  Form as AriaForm,
  Input as AriaInput,
  Label as AriaLabel,
  Modal as AriaModal,
  ModalOverlay,
} from 'react-aria-components';
import CurrencyInput from 'react-currency-input-field';

const cx = (...classes) => classes.filter(Boolean).join(' ');

const colorMap = {
  primary: 'ra-btn-primary',
  secondary: 'ra-btn-secondary',
  success: 'ra-btn-success',
  danger: 'ra-btn-danger',
  warning: 'ra-btn-warning',
  info: 'ra-btn-info',
  light: 'ra-btn-light',
  dark: 'ra-btn-dark',
  default: 'ra-btn-ghost',
  link: 'ra-btn-link',
};

const alertMap = {
  primary: 'ra-alert-primary',
  secondary: 'ra-alert-secondary',
  success: 'ra-alert-success',
  danger: 'ra-alert-danger',
  warning: 'ra-alert-warning',
  info: 'ra-alert-info',
  light: 'ra-alert-light',
};

const badgeMap = {
  primary: 'ra-badge-primary',
  secondary: 'ra-badge-secondary',
  success: 'ra-badge-success',
  danger: 'ra-badge-danger',
  warning: 'ra-badge-warning',
  info: 'ra-badge-info',
  light: 'ra-badge-light',
  dark: 'ra-badge-dark',
};

const buttonSizeMap = {
  sm: 'ra-btn-sm',
  lg: 'ra-btn-lg',
};

const toUnitClass = (prefix, value) => {
  if (value == null || value === false) return null;
  if (value === true || value === '') return prefix;
  return `${prefix}-${value}`;
};

const useTag = (tag, fallback = 'div') => tag || fallback;

export const Container = forwardRef(function Container(
  { fluid, className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag
      ref={ref}
      className={cx(fluid ? 'container-fluid' : 'container', className)}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const Row = forwardRef(function Row(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag ref={ref} className={cx('row', className)} {...props}>
      {children}
    </Tag>
  );
});

export const Col = forwardRef(function Col(
  { className, tag, xs, sm, md, lg, xl, xxl, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  const classes = [
    xs ? toUnitClass('col', xs) : 'col',
    toUnitClass('col-sm', sm),
    toUnitClass('col-md', md),
    toUnitClass('col-lg', lg),
    toUnitClass('col-xl', xl),
    toUnitClass('col-xxl', xxl),
    className,
  ];
  return (
    <Tag ref={ref} className={cx(...classes)} {...props}>
      {children}
    </Tag>
  );
});

const cardBase = (section, className) => cx('ra-card', section, className);

export const Card = forwardRef(function Card(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'section');
  return (
    <Tag ref={ref} className={cardBase('', className)} {...props}>
      {children}
    </Tag>
  );
});

export const CardHeader = forwardRef(function CardHeader(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag ref={ref} className={cardBase('ra-card-header', className)} {...props}>
      {children}
    </Tag>
  );
});

export const CardBody = forwardRef(function CardBody(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag ref={ref} className={cardBase('ra-card-body', className)} {...props}>
      {children}
    </Tag>
  );
});

export const CardFooter = forwardRef(function CardFooter(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag ref={ref} className={cardBase('ra-card-footer', className)} {...props}>
      {children}
    </Tag>
  );
});

export const CardTitle = forwardRef(function CardTitle(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'h4');
  return (
    <Tag ref={ref} className={cx('ra-card-title', className)} {...props}>
      {children}
    </Tag>
  );
});

export const CardText = forwardRef(function CardText(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'p');
  return (
    <Tag ref={ref} className={cx('ra-card-text', className)} {...props}>
      {children}
    </Tag>
  );
});

export const Form = forwardRef(function Form(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'form');
  if (!tag || tag === 'form') {
    return (
      <AriaForm ref={ref} className={cx('ra-form', className)} {...props}>
        {children}
      </AriaForm>
    );
  }
  return (
    <Tag ref={ref} className={cx('ra-form', className)} {...props}>
      {children}
    </Tag>
  );
});

export const FormGroup = forwardRef(function FormGroup(
  { className, tag, floating, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag
      ref={ref}
      className={cx(
        'ra-form-group',
        floating && 'ra-form-group-floating',
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const Label = forwardRef(function Label(
  { className, tag, children, htmlFor, for: legacyFor, ...props },
  ref
) {
  const Tag = useTag(tag, 'label');
  const labelProps = {
    ...props,
    ...(htmlFor || legacyFor ? { htmlFor: htmlFor || legacyFor } : {}),
  };
  if (!tag || tag === 'label') {
    return (
      <AriaLabel ref={ref} className={cx('ra-label', className)} {...labelProps}>
        {children}
      </AriaLabel>
    );
  }
  return (
    <Tag ref={ref} className={cx('ra-label', className)} {...labelProps}>
      {children}
    </Tag>
  );
});

export const FormFeedback = forwardRef(function FormFeedback(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  if (!tag || tag === 'div') {
    return (
      <AriaFieldError ref={ref} className={cx('ra-feedback', className)} {...props}>
        {children}
      </AriaFieldError>
    );
  }
  return (
    <Tag ref={ref} className={cx('ra-feedback', className)} {...props}>
      {children}
    </Tag>
  );
});

export const Input = forwardRef(function Input(
  { className, type = 'text', invalid, tag, children, ...props },
  ref
) {
  if (type === 'select') {
    return (
      <select
        ref={ref}
        className={cx(
          'ra-input',
          'ra-select',
          invalid && 'ra-input-invalid',
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }

  if (type === 'textarea' || tag === 'textarea') {
    return (
      <textarea
        ref={ref}
        className={cx(
          'ra-input',
          'ra-textarea',
          invalid && 'ra-input-invalid',
          className
        )}
        {...props}
      >
        {children}
      </textarea>
    );
  }

  if (!tag || tag === 'input') {
    return (
      <AriaInput
        ref={ref}
        type={type}
        className={cx('ra-input', invalid && 'ra-input-invalid', className)}
        {...props}
      />
    );
  }

  return (
    <input
      ref={ref}
      type={type}
      className={cx('ra-input', invalid && 'ra-input-invalid', className)}
      {...props}
    />
  );
});

export const InputGroup = forwardRef(function InputGroup(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag ref={ref} className={cx('ra-input-group', className)} {...props}>
      {children}
    </Tag>
  );
});

export const InputGroupText = forwardRef(function InputGroupText(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'span');
  return (
    <Tag ref={ref} className={cx('ra-input-group-text', className)} {...props}>
      {children}
    </Tag>
  );
});

export const Button = forwardRef(function Button(
  {
    className,
    color = 'primary',
    outline,
    size,
    block,
    tag,
    children,
    onClick,
    type,
    ...props
  },
  ref
) {
  const classes = cx(
    'ra-btn',
    colorMap[color] || colorMap.primary,
    outline && 'ra-btn-outline',
    buttonSizeMap[size],
    block && 'w-100',
    className
  );

  if (tag && tag !== 'button') {
    const Tag = tag;
    return (
      <Tag
        ref={ref}
        className={classes}
        role="button"
        onClick={onClick}
        {...props}
      >
        {children}
      </Tag>
    );
  }

  return (
    <AriaButton
      ref={ref}
      type={type || 'button'}
      className={classes}
      onPress={onClick}
      {...props}
    >
      {children}
    </AriaButton>
  );
});

export const ButtonGroup = forwardRef(function ButtonGroup(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag ref={ref} className={cx('ra-button-group', className)} {...props}>
      {children}
    </Tag>
  );
});

export const Badge = forwardRef(function Badge(
  { className, color = 'secondary', pill, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'span');
  return (
    <Tag
      ref={ref}
      className={cx(
        'ra-badge',
        badgeMap[color] || badgeMap.secondary,
        pill && 'rounded-pill',
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const Alert = forwardRef(function Alert(
  { className, color = 'info', tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag
      ref={ref}
      role="alert"
      className={cx('ra-alert', alertMap[color] || alertMap.info, className)}
      {...props}
    >
      {children}
    </Tag>
  );
});

export function UncontrolledAlert({ children, ...props }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <Alert {...props}>
      <div className="d-flex align-items-start justify-content-between gap-3">
        <div>{children}</div>
        <button
          className="ra-alert-close"
          type="button"
          onClick={() => setOpen(false)}
        >
          x
        </button>
      </div>
    </Alert>
  );
}

export const Spinner = forwardRef(function Spinner(
  { className, size, color = 'primary', ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={cx(
        'spinner-border',
        size === 'sm' && 'spinner-border-sm',
        color && `text-${color === 'default' ? 'primary' : color}`,
        className
      )}
      role="status"
      aria-hidden="true"
      {...props}
    />
  );
});

const ModalContext = createContext({ toggle: undefined, titleId: undefined });

export function Modal({
  isOpen,
  toggle,
  children,
  size,
  className,
  centered,
  modalClassName,
  overlayClassName,
  backdrop = true,
  keyboard = true,
  ...props
}) {
  const titleId = useId();
  const handleOpenChange = (nextOpen) => {
    if (!nextOpen) {
      toggle?.();
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <ModalOverlay
      isOpen={Boolean(isOpen)}
      onOpenChange={handleOpenChange}
      isDismissable={backdrop !== 'static'}
      isKeyboardDismissDisabled={keyboard === false}
      className={cx('ra-modal-overlay', overlayClassName)}
    >
      <AriaModal
        className={cx(
          'ra-modal-shell',
          size ? `ra-modal-${size}` : 'ra-modal-md',
          centered && 'ra-modal-centered',
          modalClassName
        )}
      >
        <Dialog
          aria-labelledby={titleId}
          className={cx('ra-modal-content', className)}
          {...props}
        >
          <ModalContext.Provider value={{ toggle, titleId }}>
            {children}
          </ModalContext.Provider>
        </Dialog>
      </AriaModal>
    </ModalOverlay>,
    document.body
  );
}

export function ModalHeader({ className, toggle, children, ...props }) {
  const context = useContext(ModalContext);
  const onClose = toggle || context.toggle;
  return (
    <div className={cx('ra-modal-header', className)} {...props}>
      <h2 id={context.titleId} className="ra-modal-title">
        {children}
      </h2>
      {onClose ? (
        <button
          type="button"
          className="ra-modal-close"
          aria-label="Close"
          onClick={onClose}
        >
          x
        </button>
      ) : null}
    </div>
  );
}

export function ModalBody({
  className,
  children,
  disableCustomScrollbar = false,
  ...props
}) {
  return (
    <div
      className={cx(
        'ra-modal-body',
        !disableCustomScrollbar && 'kuku-scrollbar kuku-scrollbar-y',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModalFooter({ className, children, ...props }) {
  return (
    <div className={cx('ra-modal-footer', className)} {...props}>
      {children}
    </div>
  );
}

const DropdownContext = createContext(null);

function useDropdownState(
  controlledOpen,
  controlledToggle,
  defaultOpen = false
) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen != null ? controlledOpen : internalOpen;
  const setOpen = (next) => {
    if (controlledToggle) {
      controlledToggle(typeof next === 'function' ? next(open) : next);
      return;
    }
    setInternalOpen(typeof next === 'function' ? next(open) : next);
  };
  return { open, setOpen };
}

export function Dropdown({ isOpen, toggle, children, className, ...props }) {
  const state = useDropdownState(isOpen, toggle);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleOutside = (event) => {
      if (!state.open) return;
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        state.setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [state]);

  return (
    <DropdownContext.Provider value={state}>
      <div ref={wrapperRef} className={cx('ra-dropdown', className)} {...props}>
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

export function UncontrolledDropdown({
  children,
  className,
  nav,
  onToggle,
  ...props
}) {
  const [open, setOpen] = useState(false);
  const toggle = (next) => {
    const nextValue = typeof next === 'boolean' ? next : !open;
    setOpen(nextValue);
    onToggle?.(nextValue);
  };
  return (
    <Dropdown
      isOpen={open}
      toggle={toggle}
      className={cx(nav && 'ra-dropdown-nav', className)}
      {...props}
    >
      {children}
    </Dropdown>
  );
}

export const DropdownToggle = forwardRef(function DropdownToggle(
  { className, caret, tag, children, onClick, ...props },
  ref
) {
  const dropdown = useContext(DropdownContext);
  const content = (
    <>
      {children}
      {caret ? <span className="ra-caret">v</span> : null}
    </>
  );
  const handleClick = (event) => {
    onClick?.(event);
    if (!event.defaultPrevented) {
      dropdown?.setOpen((prev) => !prev);
    }
  };

  if (tag && tag !== 'button') {
    const Tag = tag;
    return (
      <Tag
        ref={ref}
        className={cx('ra-dropdown-toggle', className)}
        onClick={handleClick}
        {...props}
      >
        {content}
      </Tag>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      className={cx('ra-dropdown-toggle', className)}
      onClick={handleClick}
      {...props}
    >
      {content}
    </button>
  );
});

export const DropdownMenu = forwardRef(function DropdownMenu(
  { className, tag, children, right, bottom, ...props },
  ref
) {
  const dropdown = useContext(DropdownContext);
  const Tag = useTag(tag, 'div');
  if (!dropdown?.open) return null;
  return (
    <Tag
      ref={ref}
      className={cx(
        'ra-dropdown-menu',
        right && 'ra-dropdown-menu-right',
        bottom && 'ra-dropdown-menu-bottom',
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const DropdownItem = forwardRef(function DropdownItem(
  { className, divider, tag, children, onClick, ...props },
  ref
) {
  const dropdown = useContext(DropdownContext);
  if (divider) {
    const Tag = useTag(tag, 'div');
    return (
      <Tag
        className={cx('ra-dropdown-divider', className)}
        ref={ref}
        {...props}
      />
    );
  }

  const Tag = useTag(tag, 'button');
  const handleClick = (event) => {
    onClick?.(event);
    dropdown?.setOpen(false);
  };

  return (
    <Tag
      ref={ref}
      className={cx('ra-dropdown-item', className)}
      onClick={handleClick}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const Nav = forwardRef(function Nav(
  { className, tag, navbar, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'ul');
  return (
    <Tag
      ref={ref}
      className={cx('ra-nav', navbar && 'ra-nav-navbar', className)}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const NavItem = forwardRef(function NavItem(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'li');
  return (
    <Tag ref={ref} className={cx('ra-nav-item', className)} {...props}>
      {children}
    </Tag>
  );
});

export const NavLink = forwardRef(function NavLink(
  { className, tag, children, href = '#', ...props },
  ref
) {
  const Tag = useTag(tag, 'a');
  return (
    <Tag
      ref={ref}
      className={cx('ra-nav-link', className)}
      href={Tag === 'a' ? href : undefined}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const Navbar = forwardRef(function Navbar(
  { className, tag, children, expand, dark, light, ...props },
  ref
) {
  const Tag = useTag(tag, 'nav');
  return (
    <Tag
      ref={ref}
      className={cx(
        'navbar',
        'ra-navbar',
        dark && 'ra-navbar-dark',
        light && 'ra-navbar-light',
        expand && `navbar-expand-${expand}`,
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const NavbarBrand = forwardRef(function NavbarBrand(
  { className, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'a');
  return (
    <Tag
      ref={ref}
      className={cx('navbar-brand', 'ra-navbar-brand', className)}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const NavbarToggler = forwardRef(function NavbarToggler(
  { className, children, ...props },
  ref
) {
  return (
    <Button
      ref={ref}
      className={cx('navbar-toggler', 'ra-navbar-toggler', className)}
      color="default"
      {...props}
    >
      {children}
    </Button>
  );
});

export const Collapse = forwardRef(function Collapse(
  { className, isOpen, navbar, children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cx(
        'ra-collapse',
        'collapse',
        navbar && 'navbar-collapse',
        isOpen && 'show',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});

export const ListGroup = forwardRef(function ListGroup(
  { className, tag, flush, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag
      ref={ref}
      className={cx('ra-list-group', flush && 'ra-list-group-flush', className)}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const ListGroupItem = forwardRef(function ListGroupItem(
  { className, tag, children, action, ...props },
  ref
) {
  const Tag = useTag(tag, 'div');
  return (
    <Tag
      ref={ref}
      className={cx(
        'ra-list-group-item',
        action && 'ra-list-group-item-action',
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
});

export const Table = forwardRef(function Table(
  { className, responsive, striped, hover, children, ...props },
  ref
) {
  const table = (
    <table
      ref={ref}
      className={cx(
        'ra-table',
        striped && 'table-striped',
        hover && 'table-hover',
        className
      )}
      {...props}
    >
      {children}
    </table>
  );

  if (responsive) {
    return (
      <div className="table-responsive kuku-scrollbar kuku-scrollbar-both">
        {table}
      </div>
    );
  }

  return table;
});

export const Pagination = forwardRef(function Pagination(
  { className, size, tag, children, ...props },
  ref
) {
  const Tag = useTag(tag, 'nav');
  return (
    <Tag ref={ref} className={cx('ra-pagination-wrap', className)} {...props}>
      <ul className={cx('ra-pagination', size === 'sm' && 'ra-pagination-sm')}>
        {children}
      </ul>
    </Tag>
  );
});

export const PaginationItem = forwardRef(function PaginationItem(
  { className, active, disabled, children, ...props },
  ref
) {
  return (
    <li
      ref={ref}
      className={cx(
        'ra-pagination-item',
        active && 'active',
        disabled && 'disabled',
        className
      )}
      {...props}
    >
      {children}
    </li>
  );
});

export const PaginationLink = forwardRef(function PaginationLink(
  { className, previous, next, children, onClick, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx('ra-pagination-link', className)}
      onClick={onClick}
      {...props}
    >
      {previous ? '<' : next ? '>' : children}
    </button>
  );
});

export function Tooltip({ target, children }) {
  useEffect(() => {
    if (!target || typeof document === 'undefined') return undefined;
    const element = document.getElementById(target);
    if (!element) return undefined;
    const previous = element.getAttribute('title');
    const text =
      typeof children === 'string'
        ? children
        : element.getAttribute('aria-label') || '';
    if (text) {
      element.setAttribute('title', text);
    }
    return () => {
      if (previous == null) {
        element.removeAttribute('title');
      } else {
        element.setAttribute('title', previous);
      }
    };
  }, [target, children]);

  return null;
}

export const UncontrolledTooltip = Tooltip;

export function AmountInput({name, value, onChange, style, disabled}) {
  // console.log('AmountInput: value=', value, 'disabled=', disabled);

  return (
    <div className="ra-amount-input-wrapper">
      <CurrencyInput
        name={name}
        disabled={disabled}
        value={value}
        onValueChange={(value) => onChange({ target: { name, value, type: 'number' } })}
        className="amount-input"
        prefix="₦"
        decimalsLimit={2}
        allowNegativeValue={false}
        style={style}
      />
    </div>
  )
}
