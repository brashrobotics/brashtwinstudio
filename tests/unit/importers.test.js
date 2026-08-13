import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  inspectExternalDataset,
  inspectIfcStepFile,
  inspectTumTrajectory,
  verifyDatasetDirectory,
} from "@brash-twin/importers";

const IFC = `ISO-10303-21;
HEADER;
FILE_NAME('tiny.ifc','2026-08-13T00:00:00Z',(''),(''),'test','test','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#2=IFCUNITASSIGNMENT((#1));
#3=IFCPROJECT('project',#9,'Project',$,$,$,$,(#8),#2);
#4=IFCSITE('site',#9,'Site',$,$,#8,$,$,.ELEMENT.,$,$,$,$,$);
#5=IFCBUILDING('building',#9,'Building',$,$,#8,$,$,.ELEMENT.,$,$,$);
#6=IFCBUILDINGSTOREY('storey',#9,'Floor 1',$,$,#8,$,$,.ELEMENT.,2500.);
#7=IFCWALLSTANDARDCASE('wall',#9,'Wall',$,$,#8,#10,$,.NOTDEFINED.);
ENDSEC;
END-ISO-10303-21;
`;

const TRAJECTORY = `# timestamp tx ty tz qx qy qz qw
1000 0 0 0 0 0 0 1
1001 3 0 0 0 0 0 1
1002 3 4 0 0 0 0 1
`;

test("IFC STEP inspector preserves source units and reports canonical metre elevations", async () => {
  await withFixture(async (directory) => {
    const path = join(directory, "tiny.ifc");
    await writeFile(path, IFC);
    const report = await inspectIfcStepFile(path);
    assert.equal(report.schema, "IFC4");
    assert.equal(report.lengthUnit.toMetres, 0.001);
    assert.equal(report.spatialStructure.storeys[0].elevationMetres, 2.5);
    assert.equal(report.elementCounts.walls, 1);
  });
});

test("TUM inspector validates time and quaternion invariants and measures the path", async () => {
  await withFixture(async (directory) => {
    const path = join(directory, "trajectory.tum");
    await writeFile(path, TRAJECTORY);
    const report = await inspectTumTrajectory(path);
    assert.equal(report.sampleCount, 3);
    assert.equal(report.pathLengthMetres, 7);
    assert.deepEqual(report.qualityWarnings, []);
    assert.deepEqual(report.positionBounds, { minimum: [0, 0, 0], maximum: [3, 4, 0] });
    assert.equal(report.timestamp.durationSeconds, 2);
  });
});

test("external dataset inspection rejects checksum mutation and accepts verified inputs", async () => {
  await withFixture(async (directory) => {
    await writeFile(join(directory, "tiny.ifc"), IFC);
    await writeFile(join(directory, "trajectory.tum"), TRAJECTORY);
    const descriptor = datasetDescriptor(IFC, TRAJECTORY);
    const verification = await verifyDatasetDirectory(descriptor, directory);
    assert.equal(verification.valid, true);
    const report = await inspectExternalDataset(descriptor, directory);
    assert.equal(report.summary.trajectorySessionCount, 1);
    assert.equal(report.summary.trajectorySampleCount, 3);

    await writeFile(join(directory, "trajectory.tum"), `${TRAJECTORY}1003 4 4 0 0 0 0 1\n`);
    const changed = await verifyDatasetDirectory(descriptor, directory);
    assert.equal(changed.valid, false);
    assert.ok(changed.errors.some((error) => error.code === "DATASET_CHECKSUM_MISMATCH"));
  });
});

function datasetDescriptor(ifc, trajectory) {
  return {
    schemaVersion: "brash.external-dataset/v1",
    datasetId: "tiny-dataset",
    title: "Tiny Dataset",
    source: { landingPage: "https://example.test/dataset" },
    rights: { license: "TEST-ONLY", purpose: "TEST" },
    files: [
      file("tiny.ifc", "BIM_REFERENCE", ifc),
      { ...file("trajectory.tum", "REFERENCE_TRAJECTORY", trajectory), sessionId: "session-1" },
    ],
  };
}

function file(path, role, content) {
  return {
    path,
    role,
    bytes: Buffer.byteLength(content),
    sha512: createHash("sha512").update(content).digest("hex"),
  };
}

async function withFixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), "brash-importers-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
