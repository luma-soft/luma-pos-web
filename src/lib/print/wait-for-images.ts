interface PrintImageLike {
  complete: boolean;
  addEventListener(type: "load" | "error", listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: "load" | "error", listener: () => void): void;
}

function waitForPrintImage(image: PrintImageLike, timeoutMs: number) {
  if (image.complete) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timeoutId);
      image.removeEventListener("load", done);
      image.removeEventListener("error", done);
      resolve();
    };
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
    const timeoutId = setTimeout(done, timeoutMs);
    // Cover an image completing between the initial check and listener setup.
    if (image.complete) done();
  });
}

export async function waitForPrintImages(images: Iterable<PrintImageLike>, timeoutMs = 5000) {
  await Promise.all(Array.from(images, (image) => waitForPrintImage(image, timeoutMs)));
}
