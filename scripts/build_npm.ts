import { build, emptyDir } from "https://deno.land/x/dnt@0.36.0/mod.ts";
import { Input } from "https://deno.land/x/cliffy@v0.25.4/prompt/mod.ts";

await emptyDir("./npm");

const Version =
  Deno.args[0] ??
  (await Input.prompt({
    message: "Enter the version:",
  }));

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  shims: {
    // see JS docs for overview and more options
    deno: true,
  },
  package: {
    name: "@oridune/mongo",
    version: Version,
    description: "A next generation MongoDB ODM.",
    repository: {
      type: "git",
      url: "git+https://github.com/Oridune/mongo.git",
    },
    keywords: [
      "oridune",
      "document",
      "mongo",
      "mongodb",
      "mongoose",
      "odm",
      "orm",
    ],
    author: "Saif Ali Khan",
    license: "MIT",
    bugs: {
      url: "https://github.com/Oridune/mongo/issues",
    },
    homepage: "https://github.com/Oridune/mongo#readme",
  },
  postBuild() {
    // steps to run after building and before running the tests
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
