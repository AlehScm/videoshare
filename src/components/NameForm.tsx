"use client";

import { useState } from "react";
import { cleanName, MAX_NAME_LENGTH } from "@/lib/name-storage";
import { inputClass, primaryButtonClass } from "@/lib/styles";

type Props = {
  submitLabel: string;
  onSubmit: (name: string) => void;
};

export function NameForm({ submitLabel, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const name = cleanName(value);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name) onSubmit(name);
      }}
    >
      <label htmlFor="nome" className="text-sm font-medium">
        Seu nome
      </label>
      <input
        id="nome"
        autoFocus
        autoComplete="nickname"
        maxLength={MAX_NAME_LENGTH}
        placeholder="Como quer aparecer na sala?"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={inputClass}
      />
      <button type="submit" disabled={!name} className={primaryButtonClass}>
        {submitLabel}
      </button>
    </form>
  );
}
