import { DesktopDownloadLink } from "@/components/DesktopDownloadLink";
import { HomeForm } from "@/components/HomeForm";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-5xl font-bold tracking-tight">videoshare</h1>
        <p className="text-lg text-muted">
          Crie uma sala, mande o link e compartilhe sua tela com quem entrar.
        </p>
      </header>
      <HomeForm />
      <p className="text-sm text-muted">
        A tela vai direto do seu navegador pro de quem está assistindo. Nada passa por servidor.
      </p>
      <DesktopDownloadLink />
    </main>
  );
}
