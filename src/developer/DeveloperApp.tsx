import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CircleAlert, Hospital } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Toaster } from "@/components/ui/sonner";
import type { YandexMapHost } from "../components/YandexMap";
import { createDeveloperUI } from "../runtime/developer-ui-store";
import { DeveloperHeader } from "./DeveloperHeader";
import { CalculationSidebar } from "./CalculationSidebar";
import { DeveloperMap } from "./DeveloperMap";
import { DeveloperTables, type DeveloperTablesHandle } from "./DeveloperTables";
import { DeveloperAbout } from "./DeveloperAbout";
import { DeveloperSettings } from "./DeveloperSettings";
import { BackupDialog } from "./BackupDialog";
import { CellDialog } from "./CellDialog";
import * as UI from "./DeveloperUI";
function Notifications() {
  const field = UI.useField("toast");
  useEffect(() => {
    if (!field.hidden && field.textContent)
      toast(field.textContent, { id: "developer-message", duration: 6500 });
  }, [field.hidden, field.textContent]);
  return <Toaster theme="light" position="bottom-right" />;
}
function DeveloperWorkspace() {
  const [store] = useState(() => createDeveloperUI());
  const tables = useRef<DeveloperTablesHandle>(null),
    release = useRef<(() => void) | null>(null);
  const [startupError, setStartupError] = useState("");
  const onHostReady = useCallback(
    (host: YandexMapHost | null) => {
      release.current?.();
      release.current = null;
      if (!host) return;
      let active = true,
        dispose: (() => void) | undefined;
      void import("../runtime/developer-controller.js")
        .then(({ mountDeveloperController }) => {
          if (active && tables.current)
            dispose = mountDeveloperController(store, host, tables.current);
        })
        .catch((error) => {
          if (active)
            setStartupError(
              error instanceof Error
                ? error.message
                : "Не удалось загрузить инструменты разработчика.",
            );
        });
      release.current = () => {
        active = false;
        dispose?.();
      };
    },
    [store],
  );
  return (
    <UI.Provider store={store}>
      <div id="developer-workspace">
        {startupError && (
          <Alert role="alert">
            <CircleAlert />
            <AlertDescription>
              Не удалось запустить инструменты: {startupError}. Перезагрузите
              страницу.
            </AlertDescription>
          </Alert>
        )}
        <DeveloperHeader />
        <main>
          <UI.Section
            id="map-view"
            role="tabpanel"
            aria-labelledby="developer-tab-map"
            tabIndex={0}
            className="view map-layout"
          >
            <CalculationSidebar />
            <DeveloperMap onHostReady={onHostReady} />
          </UI.Section>
          <UI.Section
            id="table-view"
            role="tabpanel"
            aria-labelledby="developer-tab-table"
            tabIndex={0}
            className="view table-view"
          >
            <DeveloperTables ref={tables} />
          </UI.Section>
          <DeveloperAbout />
        </main>
        <CellDialog />
        <DeveloperSettings />
        <BackupDialog />
        <Notifications />
      </div>
    </UI.Provider>
  );
}
export function DeveloperApp() {
  const [unlocked, setUnlocked] = useState(false),
    [code, setCode] = useState(""),
    [error, setError] = useState("");
  const codeInput = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code !== "immortaL") {
      setError("Неверный код доступа. Проверьте код и попробуйте снова.");
      codeInput.current?.select();
      return;
    }
    setCode("");
    setUnlocked(true);
  };
  return unlocked ? (
    <DeveloperWorkspace />
  ) : (
    <section id="developer-gate" className="developer-gate">
      <Card className="developer-login">
        <CardHeader>
          <Hospital aria-hidden="true" />
          <CardTitle>
            <h1>Режим разработчика</h1>
          </CardTitle>
          <CardDescription>
            Расчёты, данные и резервные копии проекта.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="developer-login" onSubmit={submit}>
            <Label htmlFor="developer-code">Код доступа</Label>
            <Input
              ref={codeInput}
              id="developer-code"
              type="password"
              autoComplete="off"
              required
              maxLength={8}
              minLength={8}
              autoFocus
              value={code}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "developer-error" : undefined}
              onChange={(event) => {
                setCode(event.target.value);
                setError("");
              }}
            />
            {error && (
              <Alert id="developer-error" role="alert">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="full">
              Войти
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
