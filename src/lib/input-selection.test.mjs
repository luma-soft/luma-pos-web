import { expect, test } from "bun:test";
import { selectAllInputOnClick } from "./input-selection.ts";

test("selects an existing search value on click", () => {
  let selections = 0;
  const input = {
    value: "Bộ phao bồn cầu cao",
    select: () => {
      selections += 1;
    },
  };

  selectAllInputOnClick({ currentTarget: input });

  expect(selections).toBe(1);
});

test("does not create a selection for an empty search value", () => {
  let selections = 0;
  const input = {
    value: "",
    select: () => {
      selections += 1;
    },
  };

  selectAllInputOnClick({ currentTarget: input });

  expect(selections).toBe(0);
});
