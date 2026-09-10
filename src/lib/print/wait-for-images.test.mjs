import { expect, test } from "bun:test";
import { waitForPrintImages } from "./wait-for-images";

class TestImage extends EventTarget {
  complete = false;
}

test("waits until a pending print image loads", async () => {
  const image = new TestImage();
  let settled = false;
  const waiting = waitForPrintImages([image]).then(() => { settled = true; });

  await Promise.resolve();
  expect(settled).toBe(false);
  image.complete = true;
  image.dispatchEvent(new Event("load"));
  await waiting;
  expect(settled).toBe(true);
});

test("does not wait for images that are already complete", async () => {
  const image = new TestImage();
  image.complete = true;
  await expect(waitForPrintImages([image])).resolves.toBeUndefined();
});

test("continues printing when an image fails to load", async () => {
  const image = new TestImage();
  const waiting = waitForPrintImages([image]);
  image.dispatchEvent(new Event("error"));
  await expect(waiting).resolves.toBeUndefined();
});
