import { HomeForm } from "@/components/HomeForm";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-12">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">videoshare</h1>
        <p className="text-zinc-500">
          Escolha um nome, crie uma sala e mande o link. Quem entrar aparece aqui na hora.
        </p>
      </header>
      <HomeForm />
      <p className="text-center text-xs text-zinc-400">
        Conexão direta entre navegadores (P2P). Nada fica salvo em servidor.
      </p>
    </main>
  );
}
