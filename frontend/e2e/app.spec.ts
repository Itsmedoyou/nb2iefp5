import { expect, test } from "@playwright/test";

test.describe("Decision replay", () => {
  test("shows the latest forecast before the 09:20 order deadline", async ({ page }) => {
    await page.goto("/#decision?date=2026-01-15");
    const banner = page.getByTestId("decision-banner");
    await expect(banner).toContainText("Thursday, 15 January 2026");
    await expect(banner).toContainText("Order deadline (market close)");
    await expect(banner).toContainText("Wed 14 Jan 09:20");
    await expect(banner).toContainText("Latest forecast available before deadline");
    await expect(page.getByTestId("colour-key")).toContainText("Forecast higher than actual: less wind came than expected, so you bought too little");
    await expect(page.getByTestId("forecast-used")).toHaveText("Published Wed 14 Jan 07:30");
    await expect(page.getByTestId("tile-forecast")).toContainText("279 GWh");
    await expect(page.getByTestId("tile-actual")).toContainText("254 GWh");
    const diffTile = page.getByTestId("tile-diff");
    await expect(diffTile).toContainText("25 GWh");
    await expect(diffTile.locator(".badge")).toHaveText("9% of forecast");
    await expect(diffTile).toContainText("forecast higher than actual");
    await expect(diffTile).toContainText("The wind produced 25 GWh less than forecast. That shortfall had to be bought at the last minute.");
    // Cards in order: forecast, actual, difference, average miss, biggest miss.
    await expect(page.locator(".tiles .tile .label")).toHaveText([
      "Forecast wind energy",
      "Actual wind energy",
      "Difference for the day",
      "Average miss per hour",
      "Biggest miss",
    ]);
    await expect(page.getByTestId("tile-biggest")).toContainText("forecast higher than actual");
    // Chart rendered with forecast and actual lines plus the band (corrected line off by default).
    await expect(page.getByTestId("forecast-chart").locator(".recharts-line")).toHaveCount(2);
    await expect(banner).not.toContainText("Looking ahead");
    await expect(page.getByTestId("forecast-chart").locator(".recharts-area")).toHaveCount(1);
  });

  test("deadline is fixed: no decision-time picker", async ({ page }) => {
    await page.goto("/#decision?date=2026-01-15");
    await expect(page.getByTestId("decision-banner")).toBeVisible();
    await expect(page.getByRole("button", { name: /09:20 EPEX|12:00 late/ })).toHaveCount(0);
    await expect(page.getByLabel("Custom decision time")).toHaveCount(0);
  });

  test("day navigation via buttons, select, strip and keyboard", async ({ page }) => {
    await page.goto("/#decision?date=2026-01-15");
    const banner = page.getByTestId("decision-banner");
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(banner).toContainText("Friday, 16 January 2026");
    await page.getByRole("combobox", { name: "Delivery day" }).selectOption("2026-02-01");
    await expect(banner).toContainText("Sunday, 1 February 2026");
    await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();
    await page.getByTestId("day-strip").getByRole("listitem").first().click();
    await expect(banner).toContainText("Friday, 2 January 2026");
    await page.keyboard.press("ArrowRight");
    await expect(banner).toContainText("Saturday, 3 January 2026");
  });

  test("corrected forecast only appears once history exists", async ({ page }) => {
    const lines = page.getByTestId("forecast-chart").locator(".recharts-line");
    await page.goto("/#decision?date=2026-01-03");
    await expect(lines).toHaveCount(2); // forecast + actual only
    await expect(page.getByText("The corrected forecast starts on 9 Jan")).toHaveCount(0);
    await page.goto("/#decision?date=2026-01-25");
    await expect(lines).toHaveCount(2); // corrected forecast is off by default
    await page.getByRole("checkbox", { name: "Corrected forecast" }).check();
    await expect(lines).toHaveCount(3);
  });

  test("comparison chart shows a day-earlier, used and too-late forecast plus actual", async ({ page }) => {
    await page.goto("/#decision?date=2026-01-15");
    const card = page.getByTestId("evolution-chart");
    await expect(card).toContainText("Forecast a day earlier1,340 MW");
    await expect(card).toContainText("Forecast used1,025 MW");
    await expect(card).toContainText("Last forecast before delivery (too late)1,286 MW");
    await expect(card.locator(".recharts-line")).toHaveCount(4);
  });

  test("tooltip shows values on hover", async ({ page }) => {
    await page.goto("/#decision?date=2026-01-15");
    const chart = page.getByTestId("forecast-chart").locator(".recharts-wrapper");
    await expect(chart.locator(".recharts-line")).toHaveCount(2);
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    await chart.hover({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
    await chart.hover({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
    const tip = page.getByTestId("forecast-chart").locator(".tooltip");
    await expect(tip).toContainText("Actual");
    await expect(tip).toContainText("Forecast");
  });
});

test.describe("Forecast accuracy", () => {
  test("headline and KPIs reflect January statistics", async ({ page }) => {
    await page.goto("/#accuracy");
    await expect(page.getByTestId("headline")).toContainText("Plan for 4,154 MW less wind");
    await expect(page.getByTestId("kpi-mae")).toContainText("2,022");
    await expect(page.getByTestId("kpi-bias")).toContainText("1,746");
    await expect(page.getByTestId("kpi-bias")).toContainText("higher than actual");
    await expect(page.getByTestId("colour-key")).toContainText("Forecast higher than actual");
    await expect(page.getByText(/systematically|bias/i)).toHaveCount(0);
    for (const id of ["daily-chart", "horizon-chart", "level-chart", "histogram-chart", "regression-card"]) {
      await expect(page.getByTestId(id).locator(".recharts-surface").first()).toBeVisible();
    }
    await expect(page.getByTestId("regression-card")).toContainText(/1,231\s*MW/);
    await expect(page.getByTestId("regression-card")).toContainText("cut the average miss by 41%");
    await expect(page.getByTestId("hour-chart")).toHaveCount(0);
  });

  test("clicking a daily bar opens that day in the replay", async ({ page }) => {
    await page.goto("/#accuracy");
    await page.getByTestId("daily-chart").locator(".recharts-bar-rectangle").nth(4).click();
    await expect(page.getByTestId("decision-banner")).toContainText("Tuesday, 6 January 2026");
  });

});

test("only the two buyer-facing tabs are shown", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("tab")).toHaveText(["Decision replay", "Forecast accuracy"]);
});

test.describe("theme", () => {
  // Even when the operating system prefers dark, the app starts light.
  test.use({ colorScheme: "dark" });

  test("light by default, dark only on click, remembered after reload", async ({ page }) => {
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.goto("/");
    await expect(page.getByTestId("decision-banner")).toBeVisible();
    expect(await bg()).toBe("rgb(244, 245, 242)");
    await page.getByRole("button", { name: "Toggle dark mode" }).click();
    expect(await bg()).toBe("rgb(13, 13, 13)");
    await page.reload();
    await expect(page.getByTestId("decision-banner")).toBeVisible();
    expect(await bg()).toBe("rgb(13, 13, 13)");
    await page.getByRole("button", { name: "Toggle dark mode" }).click();
    expect(await bg()).toBe("rgb(244, 245, 242)");
  });
});

test("no horizontal overflow and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const tab of ["decision?date=2026-01-15", "accuracy"]) {
    await page.goto(`/#${tab}`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${tab}`).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});
