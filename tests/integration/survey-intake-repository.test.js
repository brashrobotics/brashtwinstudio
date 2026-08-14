import assert from "node:assert/strict";
import test from "node:test";
import { createSurveyIntakeRecord } from "@brash-twin/domain";
import { PostgresSurveyIntakeRepository } from "@brash-twin/persistence/survey-intakes";

test("PostgreSQL survey intake repository seals intake and upload mappings in one transaction", async () => {
  const calls = [];
  const database = {
    query: async () => ({ rows: [] }),
    async transaction(operation) {
      return operation({
        async query(sql, parameters) {
          calls.push({ sql, parameters });
          return { rows: [] };
        },
      });
    },
  };
  const record = createSurveyIntakeRecord({
    intakeId: "intake-1",
    draftId: "draft-1",
    manifestUploadId: "manifest-upload-1",
    manifestArtifactSha256: "a".repeat(64),
    artifactUploads: [
      {
        artifactId: "frames-1",
        uploadId: "upload-frames-1",
        artifactSha256: "b".repeat(64),
        bytes: 12,
        mediaType: "application/json",
      },
      {
        artifactId: "map-1",
        uploadId: "upload-map-1",
        artifactSha256: "c".repeat(64),
        bytes: 24,
        mediaType: "model/vnd.ply",
      },
    ],
    operatorId: "operator-1",
    occurredAt: "2026-08-14T12:00:00.000Z",
  });
  const repository = new PostgresSurveyIntakeRepository(database);
  const created = await repository.create(record);

  assert.equal(created.status, "OPEN");
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /INSERT INTO twin_survey_intakes/);
  assert.match(calls[1].sql, /INSERT INTO twin_survey_intake_artifacts/);
  assert.equal(calls[0].sql.includes("intake-1"), false);
  assert.deepEqual(calls.slice(1).map((call) => call.parameters[1]), ["frames-1", "map-1"]);
});
