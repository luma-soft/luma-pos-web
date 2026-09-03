/** Publish local success state only after the write has actually succeeded. */
export async function commitSuccessfulMutation<T>({
  mutate,
  commit,
  onError,
}: {
  mutate: () => Promise<T>;
  commit: (result: T) => void;
  onError: (error: unknown) => void;
}): Promise<boolean> {
  let result: T;
  try {
    result = await mutate();
  } catch (error) {
    onError(error);
    return false;
  }
  commit(result);
  return true;
}
