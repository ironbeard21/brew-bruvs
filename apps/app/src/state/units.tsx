// SPDX-License-Identifier: AGPL-3.0-or-later
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { appStorage, type KeyValueStorage } from "./storage";

export type UnitSystem = "us" | "metric";

const STORAGE_KEY = "brewbruvs.units";

interface UnitsContextValue {
  unitSystem: UnitSystem;
  setUnitSystem: (next: UnitSystem) => void;
  toggleUnitSystem: () => void;
}

const UnitsContext = createContext<UnitsContextValue | null>(null);

export interface UnitsProviderProps {
  children: ReactNode;
  initialUnitSystem?: UnitSystem;
  storage?: KeyValueStorage;
}

export function UnitsProvider({
  children,
  initialUnitSystem = "us",
  storage = appStorage,
}: UnitsProviderProps) {
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>(initialUnitSystem);

  useEffect(() => {
    let active = true;
    void storage.getItem(STORAGE_KEY).then((saved) => {
      if (!active) return;
      if (saved === "us" || saved === "metric") {
        setUnitSystemState(saved);
      }
    });
    return () => {
      active = false;
    };
  }, [storage]);

  const setUnitSystem = useCallback(
    (next: UnitSystem) => {
      setUnitSystemState(next);
      void storage.setItem(STORAGE_KEY, next);
    },
    [storage],
  );

  const toggleUnitSystem = useCallback(() => {
    setUnitSystemState((current) => {
      const next: UnitSystem = current === "us" ? "metric" : "us";
      void storage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, [storage]);

  return (
    <UnitsContext.Provider value={{ unitSystem, setUnitSystem, toggleUnitSystem }}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) {
    throw new Error("useUnits must be used within a UnitsProvider");
  }
  return ctx;
}
