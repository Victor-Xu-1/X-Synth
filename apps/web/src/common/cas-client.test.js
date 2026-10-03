import { validateCasAuthority } from "./cas-client";

test("CAS authority is restricted to its actual HTTPS domain", () => {
  expect(validateCasAuthority("https://sso.cas.org/oauth2")).toBe("https://sso.cas.org/oauth2");
  for (const url of ["https://cas.org.attacker.example/", "http://sso.cas.org/", "https://user:secret@sso.cas.org/"]) {
    expect(() => validateCasAuthority(url)).toThrow();
  }
});
