import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ProjectFileBridge,
  ProjectFileHandle,
} from "../editor/project-files";

export const nativeProjectFiles: ProjectFileBridge = {
  get available() {
    return isTauri();
  },
  choose: (save, current) =>
    invoke<ProjectFileHandle | null>("choose_project", { save, current }),
  async read(token) {
    const bytes = await invoke<ArrayBuffer | number[]>("read_project", {
      token,
    });
    return new Uint8Array(bytes);
  },
  write: (token, bytes) =>
    invoke<string | null>("write_project", bytes, {
      headers: { "x-project-token": token },
    }),
};
