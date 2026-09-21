import { describe, expect, it } from "vitest";
import { buildSockseekCsv } from "./sockseekCsv";

describe("Sockseek CSV export", () => {
  it("uses automatically recognized headers and keeps track order", () => {
    expect(buildSockseekCsv([
      { artist: "Second Artist", title: "First song", mix_version: null },
      { artist: "First Artist", title: "Second song", mix_version: "Extended Mix" },
    ])).toBe('artist,title\r\n"Second Artist","First song"\r\n"First Artist","Second song (Extended Mix)"\r\n');
  });

  it("quotes commas, embedded quotes, line breaks, and Unicode without losing metadata", () => {
    expect(buildSockseekCsv([
      { artist: 'Björk, "Guest"', title: "One\r\nTwo", mix_version: null },
    ])).toBe('artist,title\r\n"Björk, ""Guest""","One\r\nTwo"\r\n');
  });

  it("does not append a mix already present at the end of the title", () => {
    expect(buildSockseekCsv([
      { artist: "Artist", title: "Song (Extended Mix)", mix_version: " extended mix " },
      { artist: "Artist", title: "Song [Dub]", mix_version: "Dub" },
    ])).toBe('artist,title\r\n"Artist","Song (Extended Mix)"\r\n"Artist","Song [Dub]"\r\n');
  });

  it("handles empty lists and missing metadata", () => {
    expect(buildSockseekCsv([])).toBe("artist,title\r\n");
    expect(buildSockseekCsv([{ artist: "", title: "Unknown", mix_version: "  " }]))
      .toBe('artist,title\r\n"","Unknown"\r\n');
  });
});
