import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type ElementType,
  type ReactNode,
} from "react";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch as ShadcnSwitch } from "@/components/ui/switch";
import { Progress as ShadcnProgress } from "@/components/ui/progress";
import {
  Dialog as ShadcnDialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createDeveloperUI } from "../runtime/developer-ui-store";
import {
  rememberDialogOpener,
  restoreDialogFocus,
  hasDialogOpener,
} from "./dialog-focus";
const openerDialogs: Record<string, string> = {
  "open-settings": "settings-dialog",
  "connect-map": "settings-dialog",
  "open-backup": "backup-dialog",
  "export-local-data": "backup-dialog",
};

export type DeveloperUIStore = ReturnType<typeof createDeveloperUI>;
const Context = createContext<DeveloperUIStore | null>(null);
export function Provider({
  store,
  children,
}: {
  store: DeveloperUIStore;
  children: ReactNode;
}) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useUI() {
  const store = useContext(Context);
  if (!store) throw new Error("Не подключено состояние интерфейса.");
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return store;
}
export function useField(id: string) {
  return useUI().get(id);
}
function useFocus(id: string) {
  const field = useField(id),
    ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (field.focusVersion) ref.current?.focus();
  }, [field.focusVersion]);
  return ref;
}
export function Button({
  id,
  children,
  ...props
}: ComponentProps<typeof ShadcnButton> & { id: string }) {
  const store = useUI(),
    field = store.get(id);
  return (
    <ShadcnButton
      {...props}
      type={props.type ?? "button"}
      id={id}
      hidden={field.hidden || props.hidden}
      disabled={field.disabled || props.disabled}
      onClick={(event) => {
        const dialogId = openerDialogs[id];
        if (dialogId)
          rememberDialogOpener(
            store,
            dialogId,
            event.currentTarget,
            store.get(dialogId).open,
          );
        props.onClick?.(event);
        void store.invoke(id, "click");
      }}
    >
      {field.textContent ?? children}
    </ShadcnButton>
  );
}
export function Input({
  id,
  ...props
}: ComponentProps<typeof ShadcnInput> & { id: string }) {
  const store = useUI(),
    field = store.get(id),
    ref = useFocus(id);
  return (
    <ShadcnInput
      {...props}
      id={id}
      ref={ref}
      hidden={field.hidden || props.hidden}
      disabled={field.disabled || props.disabled}
      value={field.value ?? ""}
      onChange={(event) => {
        void store.change(id, event.target.value);
      }}
    />
  );
}
export function Select({
  id,
  options,
  label,
  ...props
}: {
  id: string;
  options: { value: string | number; label: string }[];
  label?: string;
  className?: string;
  hidden?: boolean;
  disabled?: boolean;
}) {
  const store = useUI(),
    field = store.get(id),
    empty = "__empty__";
  return (
    <ShadcnSelect
      value={String(field.value ?? "") || empty}
      disabled={field.disabled || props.disabled}
      onValueChange={(value) => {
        void store.change(id, value === empty ? "" : value);
      }}
    >
      <SelectTrigger
        id={id}
        className={props.className}
        hidden={field.hidden || props.hidden}
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={String(option.value) || empty}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadcnSelect>
  );
}
export function Switch({
  id,
  children,
  ...props
}: {
  id: string;
  children: ReactNode;
  className?: string;
  hidden?: boolean;
}) {
  const store = useUI(),
    field = store.get(id);
  return (
    <div
      className={props.className ?? "switch-field"}
      hidden={field.hidden || props.hidden}
    >
      <ShadcnSwitch
        id={id}
        checked={field.checked}
        disabled={field.disabled}
        onCheckedChange={(value) => {
          void store.change(id, value, "checked");
        }}
      />
      <Label htmlFor={id}>{children}</Label>
    </div>
  );
}
export function Text({
  id,
  as: Tag = "p",
  children,
  ...props
}: {
  id: string;
  as?: ElementType;
  children?: ReactNode;
  [key: string]: any;
}) {
  const field = useField(id);
  return (
    <Tag {...props} id={id} hidden={field.hidden || props.hidden}>
      {field.textContent ?? children}
    </Tag>
  );
}
export function Status({ id, className }: { id: string; className?: string }) {
  const field = useField(id);
  if (field.hidden || !field.textContent) return null;
  const Icon = field.error ? CircleAlert : field.success ? CircleCheck : Info;
  return (
    <Alert
      id={id}
      className={className}
      role={field.error ? "alert" : "status"}
      aria-live={field.error ? "assertive" : "polite"}
      data-state={field.error ? "error" : field.success ? "success" : "info"}
    >
      <Icon aria-hidden="true" />
      <AlertDescription>{field.textContent}</AlertDescription>
    </Alert>
  );
}
export function Section({
  id,
  children,
  as: Tag = "section",
  ...props
}: {
  id: string;
  children: ReactNode;
  as?: ElementType;
  [key: string]: any;
}) {
  const field = useField(id);
  return (
    <Tag {...props} id={id} hidden={field.hidden}>
      {children}
    </Tag>
  );
}
export function Progress({ id, ...props }: { id: string; [key: string]: any }) {
  const field = useField(id),
    value =
      field.value === undefined
        ? undefined
        : Math.min(
            100,
            (Number(field.value) / Math.max(Number(field.max), 1)) * 100,
          );
  return (
    <ShadcnProgress
      {...props}
      id={id}
      hidden={field.hidden}
      value={value}
      aria-valuetext={field["aria-valuetext"]}
    />
  );
}
export function Form({
  id,
  children,
  ...props
}: {
  id: string;
  children: ReactNode;
  [key: string]: any;
}) {
  const store = useUI();
  return (
    <form
      {...props}
      id={id}
      onSubmit={(event) => {
        event.preventDefault();
        void store.invoke(id, "submit");
      }}
    >
      {children}
    </form>
  );
}
export function Dialog({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const store = useUI(),
    field = store.get(id);
  const closeId: Record<string, string> = {
    "settings-dialog": "close-settings",
    "backup-dialog": "close-backup",
    "access-cell-dialog": "access-cell-close",
  };
  return (
    <ShadcnDialog
      open={field.open}
      onOpenChange={(value) => {
        field.open = value;
        if (!value && closeId[id]) void store.invoke(closeId[id]);
      }}
    >
      <DialogContent
        showCloseButton={false}
        id={id}
        className="developer-dialog"
        onOpenAutoFocus={() => {
          if (!hasDialogOpener(store, id))
            rememberDialogOpener(
              store,
              id,
              document.activeElement as HTMLElement,
              false,
            );
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const fallbackId =
            id === "settings-dialog"
              ? "open-settings"
              : id === "backup-dialog"
                ? "open-backup"
                : "fit-map";
          restoreDialogFocus(store, id, document.getElementById(fallbackId));
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </ShadcnDialog>
  );
}
export function File({
  id,
  label,
  ...props
}: {
  id: string;
  label: string;
  accept?: string;
  hidden?: boolean;
  className?: string;
}) {
  const store = useUI(),
    field = store.get(id),
    ref = useRef<HTMLInputElement>(null);
  return (
    <div className={props.className} hidden={props.hidden}>
      <ShadcnButton
        type="button"
        variant="outline"
        disabled={field.disabled}
        onClick={(event) => {
          if (id === "local-data-file" || id === "backup-file")
            rememberDialogOpener(
              store,
              "backup-dialog",
              event.currentTarget,
              store.get("backup-dialog").open,
            );
          ref.current?.click();
        }}
      >
        {label}
      </ShadcnButton>
      <input
        ref={ref}
        id={id}
        type="file"
        accept={props.accept ?? ".json,application/json"}
        disabled={field.disabled}
        hidden
        onChange={async (event) => {
          const input = event.currentTarget;
          const files = Array.from(input.files ?? []);
          const file = files[0];
          const target = { files, value: input.value };
          try {
            await store.invoke(id, "change", { target, currentTarget: target });
          } finally {
            if (target.value === "" && input.files?.[0] === file)
              input.value = "";
          }
        }}
      />
    </div>
  );
}
export function Data({
  id,
  children,
}: {
  id: string;
  children: (data: any) => ReactNode;
}) {
  const store = useUI();
  return <>{children(store.data(id))}</>;
}
