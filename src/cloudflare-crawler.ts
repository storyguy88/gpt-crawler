import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFile } from "fs/promises";

puppeteer.use(StealthPlugin());

async function crawlWithCloudflareBypass() {
  const browser = await puppeteer.launch({
    headless: false, // Set to true once everything works
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Set a proper viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to the page and wait for Cloudflare to clear
    console.log("Navigating to page...");
    await page.goto(
      "https://swiftpackageindex.com/gonzalezreal/swift-markdown-ui/2.4.1/documentation/markdownui",
      {
        waitUntil: "networkidle0",
        timeout: 60000,
      },
    );

    // Wait for either the content or an additional Cloudflare challenge
    await page.waitForFunction(
      () =>
        document.querySelector(".content") !== null ||
        document.querySelector("#challenge-running") !== null,
      { timeout: 30000 },
    );

    // If we hit a Cloudflare challenge, wait for it to clear
    if ((await page.$("#challenge-running")) !== null) {
      console.log("Detected Cloudflare challenge, waiting...");
      await page.waitForFunction(
        () => !document.querySelector("#challenge-running"),
        { timeout: 30000 },
      );
    }

    // Wait for the actual content
    await page.waitForSelector(".content", { timeout: 30000 });
    await page.waitForSelector(".sidebar", { timeout: 30000 });

    // Extract the content
    const content = await page.evaluate(() => {
      const contentEl = document.querySelector(".content");
      const sidebarEl = document.querySelector(".sidebar");
      return {
        content: contentEl ? contentEl.textContent : "",
        sidebar: sidebarEl ? sidebarEl.textContent : "",
        title: document.title,
      };
    });

    // Save the content
    await writeFile("markdownui-docs.json", JSON.stringify(content, null, 2));
    console.log("Content saved to markdownui-docs.json");
  } catch (error) {
    console.error("Error during crawling:", error);
  } finally {
    await browser.close();
  }
}

crawlWithCloudflareBypass().catch(console.error);
