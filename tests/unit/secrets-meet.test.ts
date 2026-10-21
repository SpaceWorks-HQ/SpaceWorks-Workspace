import { describe, it, expect, vi } from "vitest";
import { meetUrl, pollMeetEvent } from "@/lib/calendar/google";
describe("Google Meet bounded polling", () => {
  it("returns an immediate conference without making more calls", async () => {
    const read = vi.fn(), pause = vi.fn();
    expect(meetUrl((await pollMeetEvent(read, { hangoutLink: "https://meet.google.com/fixture" }, pause))!)).toBe("https://meet.google.com/fixture");
    expect(read).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
  });
  it("reads pending conferences until ready with bounded backoff", async () => {
    const read = vi.fn().mockResolvedValueOnce({ conferenceData: { createRequest: { status: { statusCode: "pending" } } } }).mockResolvedValueOnce({ conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/fixture" }] } });
    const pause = vi.fn().mockResolvedValue(undefined);
    expect(meetUrl((await pollMeetEvent(read, undefined, pause))!)).toBe("https://meet.google.com/fixture");
    expect(read).toHaveBeenCalledTimes(2); expect(pause.mock.calls.map(c => c[0])).toEqual([100, 200]);
  });
  it("stops at five tries or explicit provider failure and rejects unsafe links", async () => {
    const read = vi.fn().mockResolvedValue(null), pause = vi.fn().mockResolvedValue(undefined);
    expect(await pollMeetEvent(read, undefined, pause)).toBeNull(); expect(read).toHaveBeenCalledTimes(5);
    read.mockClear(); await pollMeetEvent(read, { conferenceData: { createRequest: { status: { statusCode: "failure" } } } }, pause); expect(read).not.toHaveBeenCalled();
    for (const hangoutLink of ["https://meet.google.com.evil.test/x", "http://meet.google.com/x", "https://user@meet.google.com/x", "javascript:alert(1)"]) expect(meetUrl({ hangoutLink })).toBeNull();
  });
});
