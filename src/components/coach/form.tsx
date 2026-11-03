"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { IDLE, type ActionState } from "@/lib/coach/action-state";
import { cn } from "@/lib/cn";

/**
 * Forms for the coach portal. Each posts to a Server Action, which checks
 * the coach's session and validates everything again on the server. Without
 * JavaScript the form still posts; with it, values are kept on errors, the
 * server's messages appear beside their fields, and destructive actions ask
 * first.
 */

/** `prefix` keeps field ids unique when a page has several forms with the same field names. */
const FormContext = createContext<{ state: ActionState; pending: boolean; prefix: string }>({ state: IDLE, pending: false, prefix: "" });

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

interface ActionFormProps {
  action: Action;
  children: ReactNode;
  /** Asked before submitting (destructive actions). */
  confirm?: string;
  /** Clear the fields after a successful save (e.g. "add another"). */
  resetOnSuccess?: boolean;
  className?: string;
  /** Accessible name for forms without a visible heading. */
  label?: string;
}

export function ActionForm({ action, children, confirm, resetOnSuccess, className, label }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const messageId = useId();
  const prefix = `${useId().replace(/[^a-zA-Z0-9]/g, "")}-`;

  useEffect(() => {
    if (state.status === "error") messageRef.current?.focus();
    if (state.status === "success" && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(event.currentTarget, submitter);
    // Submitting this way (not via the action prop) keeps typed values when the server says no.
    startTransition(() => formAction(data));
  }

  const fieldErrors = Object.entries(state.errors);
  return (
    <FormContext.Provider value={{ state, pending, prefix }}>
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate aria-label={label} aria-describedby={state.status !== "idle" ? messageId : undefined} className={cn("grid grid-cols-1 gap-5", className)}>
        <div ref={messageRef} id={messageId} tabIndex={-1} className="empty:hidden focus:outline-none">
          {state.status === "error" ? (
            <div role="alert" className="border-2 border-ink bg-white p-4">
              <p className="font-semibold">{state.message}</p>
              {fieldErrors.length > 1 ? (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {fieldErrors.map(([name, message]) => (
                    <li key={name}>
                      <a href={`#${prefix}${name}`} className="underline underline-offset-4">
                        {message}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : state.status === "success" ? (
            <p role="status" className="border-l-4 border-ink bg-white px-4 py-3 font-semibold">
              {state.message}
            </p>
          ) : null}
        </div>
        {children}
      </form>
    </FormContext.Provider>
  );
}

function useField(name: string) {
  const { state, prefix } = useContext(FormContext);
  return { error: state.errors[name], id: `${prefix}${name}` };
}

const control =
  "mt-2 block w-full min-h-11 rounded-2xl border border-muted bg-white px-3 py-2 text-base text-ink transition-colors duration-150 hover:border-ink focus-visible:border-ink aria-[invalid=true]:border-2 aria-[invalid=true]:border-ink disabled:opacity-60";

function Label({ htmlFor, children, optional }: { htmlFor: string; children: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-semibold">
      {children}
      {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
    </label>
  );
}

function Messages({ id, hint, error }: { id: string; hint?: ReactNode; error?: string }) {
  return (
    <>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold">
          <span aria-hidden="true">! </span>
          {error}
        </p>
      ) : null}
    </>
  );
}

function describedBy(hint: unknown, error: unknown, id: string): string | undefined {
  return [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
}

interface FieldProps {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "date" | "time" | "number" | "search";
  defaultValue?: string | number;
  required?: boolean;
  hint?: ReactNode;
  autoComplete?: string;
  inputMode?: "text" | "decimal" | "numeric" | "email" | "tel";
  min?: string | number;
  max?: string | number;
  maxLength?: number;
  /** Shown before the input, e.g. "£". */
  prefix?: string;
  className?: string;
}

export function Field({ name, label, type = "text", defaultValue, required, hint, autoComplete, inputMode, min, max, maxLength, prefix, className }: FieldProps) {
  const { error, id } = useField(name);
  return (
    <div className={className}>
      <Label htmlFor={id} optional={!required}>
        {label}
      </Label>
      <div className={prefix ? "relative" : undefined}>
        {prefix ? (
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 mt-1 -translate-y-1/2 text-muted">
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          name={name}
          type={type}
          defaultValue={defaultValue}
          required={required}
          autoComplete={autoComplete}
          inputMode={inputMode}
          min={min}
          max={max}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint, error, id)}
          className={cn(control, prefix && "pl-7")}
        />
      </div>
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function MoneyField(props: Omit<FieldProps, "type" | "inputMode" | "prefix">) {
  return <Field {...props} type="text" inputMode="decimal" prefix="£" />;
}

interface Option {
  value: string;
  label: string;
}

export function SelectField({ name, label, options, defaultValue, required, hint, placeholder, className }: { name: string; label: string; options: readonly Option[]; defaultValue?: string; required?: boolean; hint?: ReactNode; placeholder?: string; className?: string }) {
  const { error, id } = useField(name);
  return (
    <div className={className}>
      <Label htmlFor={id} optional={!required}>
        {label}
      </Label>
      <select id={id} name={name} defaultValue={defaultValue ?? ""} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy(hint, error, id)} className={control}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextArea({ name, label, defaultValue, required, hint, rows = 3, maxLength, className }: { name: string; label: string; defaultValue?: string; required?: boolean; hint?: ReactNode; rows?: number; maxLength?: number; className?: string }) {
  const { error, id } = useField(name);
  return (
    <div className={className}>
      <Label htmlFor={id} optional={!required}>
        {label}
      </Label>
      <textarea id={id} name={name} defaultValue={defaultValue} required={required} rows={rows} maxLength={maxLength} aria-invalid={error ? true : undefined} aria-describedby={describedBy(hint, error, id)} className={cn(control, "min-h-24")} />
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function Checkbox({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: ReactNode }) {
  const { error, id } = useField(name);
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input id={id} type="checkbox" name={name} defaultChecked={defaultChecked} aria-describedby={describedBy(hint, error, id)} className="size-5 shrink-0 accent-ink" />
        <span className="text-sm font-semibold">{label}</span>
      </label>
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function RadioGroup({ name, legend, options, defaultValue, hint }: { name: string; legend: string; options: readonly (Option & { hint?: string })[]; defaultValue?: string; hint?: ReactNode }) {
  const { error, id } = useField(name);
  return (
    <fieldset id={id} tabIndex={-1} aria-describedby={describedBy(hint, error, id)} className="focus:outline-none">
      <legend className="text-sm font-semibold">{legend}</legend>
      <Messages id={id} hint={hint} error={error} />
      <div className="mt-2 grid grid-cols-1 gap-2">
        {options.map((o) => (
          <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 border border-line bg-white px-3 py-2.5 has-[:checked]:border-ink has-[:checked]:border-2">
            <input type="radio" name={name} value={o.value} defaultChecked={defaultValue === o.value} className="mt-1 size-4 shrink-0 accent-ink" />
            <span>
              <span className="block text-sm font-semibold">{o.label}</span>
              {o.hint ? <span className="block text-sm text-muted">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const buttonStyles = {
  primary: "bg-ink text-paper border border-ink hover:bg-white hover:text-ink",
  secondary: "border border-ink bg-transparent text-ink hover:bg-ink hover:text-paper",
  quiet: "text-ink underline underline-offset-4 hover:no-underline px-0",
} as const;

export function SubmitButton({ children, pendingLabel, name, value, variant = "primary", className }: { children: ReactNode; pendingLabel?: string; name?: string; value?: string; variant?: keyof typeof buttonStyles; className?: string }) {
  const { pending } = useContext(FormContext);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors duration-150 disabled:cursor-wait disabled:opacity-60",
        buttonStyles[variant],
        className,
      )}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
