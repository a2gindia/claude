import test from "node:test";
import assert from "node:assert/strict";
import { bmrMifflinStJeor, computeTargets } from "../src/lib/nutrition.js";

test("BMR — male (Mifflin-St Jeor)", () => {
  // 10*80 + 6.25*180 - 5*30 + 5 = 1780
  assert.equal(bmrMifflinStJeor("Male", 80, 180, 30), 1780);
});

test("BMR — female", () => {
  // 10*55 + 6.25*160 - 5*28 - 161 = 1249
  assert.equal(bmrMifflinStJeor("Female", 55, 160, 28), 1249);
});

test("BMR — 'Prefer not to say' uses the averaged constant (-78)", () => {
  // same as male body but constant -78 instead of +5 -> 1780 - 83 = 1697
  assert.equal(bmrMifflinStJeor("Prefer not to say", 80, 180, 30), 1697);
});

test("targets — male / moderate / muscle gain", () => {
  const t = computeTargets({
    gender: "Male",
    weight_kg: 80,
    height_cm: 180,
    age: 30,
    activity_level: "Moderate",
    goal: "Muscle gain",
  });
  assert.equal(t.bmr, 1780);
  assert.equal(t.maintenance_kcal, 2760); // round10(1780 * 1.55)
  assert.equal(t.target_kcal, 3040); // round10(2760 * 1.10)
  assert.equal(t.protein_g, 145); // round5(1.8 * 80 = 144)
});

test("targets — female / light / fat loss", () => {
  const t = computeTargets({
    gender: "Female",
    weight_kg: 55,
    height_cm: 160,
    age: 28,
    activity_level: "Light",
    goal: "Fat loss",
  });
  assert.equal(t.maintenance_kcal, 1720); // round10(1249 * 1.375 = 1717.4)
  assert.equal(t.target_kcal, 1410); // round10(1720 * 0.82 = 1410.4)
  assert.equal(t.protein_g, 100); // round5(1.8 * 55 = 99)
});

test("targets — fat-loss deficit never drops below the floor", () => {
  const t = computeTargets({
    gender: "Female",
    weight_kg: 40,
    height_cm: 150,
    age: 60,
    activity_level: "Sedentary",
    goal: "Fat loss",
  });
  assert.equal(t.kcal_floor, 1200);
  assert.equal(t.target_kcal, 1200); // computed ~860 -> floored to 1200
});

test("targets — recomposition sits at maintenance", () => {
  const t = computeTargets({
    gender: "Male",
    weight_kg: 75,
    height_cm: 175,
    age: 35,
    activity_level: "High",
    goal: "Recomposition",
  });
  assert.equal(t.maintenance_kcal, 2890); // round10(1674 * 1.725)
  assert.equal(t.target_kcal, 2890); // factor 1.0
});
