import { describe, expect, it } from "vitest";
import { buildQuery } from "../src/tools/searchItems.js";

describe("buildQuery", () => {
  it("returns an empty string for empty input", () => {
    expect(buildQuery({})).toBe("");
    expect(buildQuery({ query: "" })).toBe("");
    expect(buildQuery({ query: "   " })).toBe("");
  });

  it("passes through a plain query", () => {
    expect(buildQuery({ query: "water mains" })).toBe("water mains");
  });

  it("trims the query", () => {
    expect(buildQuery({ query: "  parcels  " })).toBe("parcels");
  });

  it("builds an owner-only clause", () => {
    expect(buildQuery({ owner: "city_gis" })).toBe("owner:city_gis");
  });

  it("builds a type clause", () => {
    expect(buildQuery({ itemType: "Web Map" })).toBe('type:"Web Map"');
  });

  it("quotes and AND-combines multiple tags", () => {
    expect(buildQuery({ tags: ["roads", "2024"] })).toBe('tags:"roads" AND tags:"2024"');
  });

  it("skips blank tags", () => {
    expect(buildQuery({ tags: ["roads", "  ", ""] })).toBe('tags:"roads"');
  });

  it("combines query and tags with AND", () => {
    expect(buildQuery({ query: "hydrants", tags: ["water"] })).toBe('hydrants AND tags:"water"');
  });

  it("combines everything in a stable order: text, type, owner, tags", () => {
    expect(
      buildQuery({
        query: "network",
        itemType: "Feature Layer",
        owner: "utility",
        tags: ["sewer", "gravity"],
      }),
    ).toBe(
      'network AND type:"Feature Layer" AND owner:utility AND tags:"sewer" AND tags:"gravity"',
    );
  });
});
