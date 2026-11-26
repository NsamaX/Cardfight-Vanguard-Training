import { GameApp } from "../components/GameApp";
import { I18nProvider } from "../i18n/react";

export default function Page() {
  return (
    <I18nProvider>
      <GameApp />
    </I18nProvider>
  );
}
