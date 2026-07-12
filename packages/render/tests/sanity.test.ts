import { expect, it } from "vitest";
import { VERSION } from "../src/index";

it("exporta a versão do pacote", () => {
  expect(VERSION).toBe("0.1.0");
});
