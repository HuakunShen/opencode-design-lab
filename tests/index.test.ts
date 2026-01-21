import { expect, test } from "vitest";
import OpenCodeDesignLabPlugin from "../src";

test("plugin exports", () => {
  expect(typeof OpenCodeDesignLabPlugin).toBe("function");
});
