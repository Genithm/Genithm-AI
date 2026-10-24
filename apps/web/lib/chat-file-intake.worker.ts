/** V55 dedicated, bounded, offline file-inspection worker. No network or storage access. */
import { inspectChatFile } from "./chat-file-intake";

type InspectInput = { file: File };
self.onmessage = (event: MessageEvent<InspectInput>) => {
  void (async () => {
    try {
      const report = await inspectChatFile(event.data.file);
      self.postMessage({ report });
    } catch {
      // Do not forward raw file bytes, error stack, filenames or secrets.
      self.postMessage({ error: "This file could not be inspected locally." });
    }
  })();
};
