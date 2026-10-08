import fs from "node:fs";
import path from "node:path";
import { ConstantPool } from "./constant-pool.ts";
import { decodeClass, decodePackage } from "./kotlin-metadata-decode.ts";
import {
  KOTLIN_METADATA_FORMAT,
  type KotlinDeclaration,
  type KotlinMetadataBatch,
} from "./kotlin-metadata.ts";
import { ZipArchive } from "./zip.ts";

/**
 * Reads the Kotlin metadata of jars, AARs (their classes.jar and libs/*.jar)
 * and class directories into the normalized contract of kotlin-metadata.ts,
 * from class file bytes: no class is loaded, and no JVM runs. Throws on
 * metadata it cannot read, naming the class.
 */
export function readKotlinMetadata(inputs: string[]): KotlinMetadataBatch {
  return {
    format: KOTLIN_METADATA_FORMAT,
    inputs: inputs.map((input) => {
      const declarations: KotlinDeclaration[] = [];

      forEachClassFile(input, (bytes) => {
        const header = readMetadataHeader(bytes);
        const declaration = header && kotlinDeclaration(header);
        if (declaration) declarations.push(declaration);
      });

      declarations.sort((a, b) => (a.jvmName < b.jvmName ? -1 : a.jvmName > b.jvmName ? 1 : 0));
      return { path: input, declarations };
    }),
  };
}

/** The `@kotlin.Metadata` element values of one class file. */
export interface MetadataHeader {
  jvmName: string;
  /** `k`: 1 class, 2 file facade, 3 synthetic class, 4 multi-file facade, 5 multi-file part. */
  kind: number;
  /** `mv`. */
  version: number[];
  /** `d1`, `d2`: the protobuf message and its strings. */
  data1: string[];
  data2: string[];
  /** `xs`: a multi-file part's facade. */
  extraString: string;
  /** `pn`. */
  packageName: string;
  /** `xi`: flags. */
  extraInt: number;
}

/** The newest metadata a reader of Kotlin 2.4 reads: its own version, or one minor more without strict semantics. */
const NEWEST = { major: 2, minor: 4 };

/**
 * A class file's declaration in the normalized contract; undefined for a
 * class that is not API (internal, private). Throws on metadata it cannot
 * read, naming the class.
 */
export function kotlinDeclaration(header: MetadataHeader): KotlinDeclaration | undefined {
  checkVersion(header);

  const base = {
    jvmName: header.jvmName,
    metadataVersion: header.version.join("."),
    ...(header.packageName ? { jvmPackageName: header.packageName } : {}),
  };

  try {
    switch (header.kind) {
      case 1: {
        const body = decodeClass(header.data1, header.data2);
        return body && { ...base, ...body };
      }
      case 2:
        return {
          ...base,
          metadataKind: "file-facade",
          ...decodePackage(header.data1, header.data2),
        };
      case 3:
        return { ...base, metadataKind: "synthetic" };
      case 4:
        return { ...base, metadataKind: "multi-file-facade", parts: header.data1 };
      case 5:
        return {
          ...base,
          metadataKind: "multi-file-part",
          facade: header.extraString,
          ...decodePackage(header.data1, header.data2),
        };
      default:
        throw new Error(`unknown Kotlin metadata kind ${header.kind}`);
    }
  } catch (e) {
    throw new Error(`${header.jvmName}: ${(e as Error).message}`, { cause: e });
  }
}

/** The rule of kotlin-metadata-jvm's strict reading: from 1.1 (Kotlin 1.0) to one minor past its own version. */
function checkVersion(header: MetadataHeader): void {
  const [major = -1, minor = -1] = header.version;
  const strict = (header.extraInt & (1 << 3)) !== 0;
  const newest = strict ? NEWEST : { major: NEWEST.major, minor: NEWEST.minor + 1 };
  const newer = major > newest.major || (major === newest.major && minor > newest.minor);

  if (header.version.length === 0 || major <= 0 || (major === 1 && minor === 0) || newer) {
    throw new Error(
      `${header.jvmName}: unsupported Kotlin metadata version ${header.version.join(".") || "(none)"}; ` +
        `this reader reads 1.1 to ${newest.major}.${newest.minor}`,
    );
  }
}

/** Calls `visit` with every class file of a jar, an AAR or a directory; META-INF entries are skipped. */
function forEachClassFile(input: string, visit: (bytes: Buffer) => void): void {
  if (fs.statSync(input).isDirectory()) {
    const files = fs
      .readdirSync(input, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".class"))
      .sort();
    for (const file of files) visit(fs.readFileSync(path.join(input, file)));
    return;
  }

  const archive = new ZipArchive(input);
  const jars = input.endsWith(".aar")
    ? archive
        .names()
        .filter((n) => n === "classes.jar" || (n.startsWith("libs/") && n.endsWith(".jar")))
        .map((n) => new ZipArchive(archive.read(n)!))
    : [archive];

  for (const jar of jars) {
    for (const name of jar.names()) {
      if (name.endsWith(".class") && !name.startsWith("META-INF/")) visit(jar.read(name)!);
    }
  }
}

/**
 * Reads the class name and the `@kotlin.Metadata` element values from class
 * file bytes (JVMS §4): the constant pool, then the class attributes. Strings
 * are decoded only when needed. Undefined for a class without Kotlin metadata.
 */
export function readMetadataHeader(buf: Buffer): MetadataHeader | undefined {
  const pool = new ConstantPool(buf);
  let p = pool.end;
  const u1 = () => buf[p++]!;
  const u2 = () => {
    const v = buf.readUInt16BE(p);
    p += 2;
    return v;
  };
  const u4 = () => {
    const v = buf.readUInt32BE(p);
    p += 4;
    return v;
  };
  const utf8 = (i: number) => pool.utf8(i);
  const int = (i: number) => pool.int(i);

  p += 2; // access flags
  const jvmName = pool.className(u2());
  p += 2; // super class
  const interfaces = u2();
  p += 2 * interfaces;

  for (let members = 0; members < 2; members++) {
    for (let n = u2(); n > 0; n--) {
      p += 6;
      for (let attributes = u2(); attributes > 0; attributes--) {
        p += 2;
        const length = u4();
        p += length;
      }
    }
  }

  const skipElementValue = (): void => {
    const tag = String.fromCharCode(u1());

    if ("BCDFIJSZsc".includes(tag)) p += 2;
    else if (tag === "e") p += 4;
    else if (tag === "@") {
      p += 2;
      for (let n = u2(); n > 0; n--) {
        p += 2;
        skipElementValue();
      }
    } else if (tag === "[") {
      for (let n = u2(); n > 0; n--) skipElementValue();
    } else throw new Error(`class file: element value tag ${tag}`);
  };

  const constant = () => {
    p++; // the element value's tag: I or s here
    return u2();
  };
  const array = <T>(element: () => T): T[] => {
    if (u1() !== 0x5b) throw new Error("kotlin.Metadata: expected an array");
    return Array.from({ length: u2() }, element);
  };

  for (let attributes = u2(); attributes > 0; attributes--) {
    const name = utf8(u2());
    const end = u4() + p;

    if (name === "RuntimeVisibleAnnotations") {
      for (let n = u2(); n > 0; n--) {
        const type = utf8(u2());
        const pairs = u2();

        if (type !== "Lkotlin/Metadata;") {
          for (let k = 0; k < pairs; k++) {
            p += 2;
            skipElementValue();
          }
          continue;
        }

        const header: MetadataHeader = {
          jvmName,
          kind: 1,
          version: [],
          data1: [],
          data2: [],
          extraString: "",
          packageName: "",
          extraInt: 0,
        };

        for (let k = 0; k < pairs; k++) {
          const element = utf8(u2());

          if (element === "k") header.kind = int(constant());
          else if (element === "mv") header.version = array(() => int(constant()));
          else if (element === "d1") header.data1 = array(() => utf8(constant()));
          else if (element === "d2") header.data2 = array(() => utf8(constant()));
          else if (element === "xs") header.extraString = utf8(constant());
          else if (element === "pn") header.packageName = utf8(constant());
          else if (element === "xi") header.extraInt = int(constant());
          else skipElementValue();
        }

        return header;
      }
    }

    p = end;
  }

  return undefined;
}
