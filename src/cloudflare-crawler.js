import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFile } from "fs/promises";
import fs from "fs";
import path from "path";

puppeteer.use(StealthPlugin());

async function crawlWithCloudflareBypass() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const baseUrl =
    "https://swiftpackageindex.com/gonzalezreal/swift-markdown-ui/2.4.1/documentation/markdownui";
  const processedUrls = new Set();
  const urlsToProcess = [baseUrl];

  try {
    // Create docs directory if it doesn't exist
    if (!fs.existsSync("docs")) {
      fs.mkdirSync("docs");
    }

    while (urlsToProcess.length > 0) {
      const url = urlsToProcess.shift();
      if (processedUrls.has(url)) continue;

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      console.log(`Navigating to page: ${url}`);
      await page.goto(url, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });

      // Handle Cloudflare and wait for content as before...
      await page.waitForFunction(
        () =>
          document.querySelector(".content") !== null ||
          document.querySelector("#challenge-running") !== null,
        { timeout: 30000 },
      );

      if ((await page.$("#challenge-running")) !== null) {
        console.log("Detected Cloudflare challenge, waiting...");
        await page.waitForFunction(
          () => !document.querySelector("#challenge-running"),
          { timeout: 30000 },
        );
      }

      await page.waitForSelector(".content", { timeout: 30000 });
      await page.waitForSelector(".sidebar", { timeout: 30000 });

      // Extract content and find new documentation links
      console.log("Extracting content...");
      const { content, newUrls } = await page.evaluate((baseUrl) => {
        function getTextContent(element) {
          if (!element) return "";

          // Special handling for code blocks
          if (element.tagName === "PRE" && element.querySelector("code")) {
            return (
              "```\\n" +
              element.querySelector("code").textContent +
              "\\n```\\n\\n"
            );
          }

          return Array.from(element.childNodes)
            .map((node) => {
              if (node.nodeType === 3) return node.textContent.trim();
              if (node.nodeType === 1) {
                if (node.tagName === "BR") return "\\n";
                if (node.tagName === "P")
                  return getTextContent(node) + "\\n\\n";
                if (node.tagName === "LI")
                  return "• " + getTextContent(node) + "\\n";
                if (node.tagName === "A")
                  return (
                    "[" +
                    node.textContent.trim() +
                    "](" +
                    node.getAttribute("href") +
                    ")"
                  );
                return getTextContent(node);
              }
              return "";
            })
            .join(" ")
            .replace(/\\s+/g, " ")
            .replace(/\\n{3,}/g, "\\n\\n")
            .trim();
        }

        function extractStructuredContent(element) {
          // First, find all headers and their positions
          const headerPositions = [];
          const headers = element.querySelectorAll("h1, h2, h3, h4, h5, h6");
          headers.forEach((header) => {
            headerPositions.push({
              element: header,
              level: parseInt(header.tagName[1]),
              title: header.textContent.trim(),
            });
          });

          // Build a tree structure
          function buildTree(startIndex, minLevel) {
            const sections = [];
            let i = startIndex;

            while (i < headerPositions.length) {
              const header = headerPositions[i];

              // If we find a header at a higher level than our minimum, we're done with this branch
              if (header.level < minLevel) {
                break;
              }

              // Find the next header that would end this section's content
              let nextHeaderForContent = null;
              for (let j = i + 1; j < headerPositions.length; j++) {
                const nextHeader = headerPositions[j];
                if (nextHeader.level <= header.level) {
                  nextHeaderForContent = nextHeader;
                  break;
                }
              }

              // Extract content for this section
              let content = [];
              let currentElement = header.element;

              // First, get the header content itself (including any links)
              const headerContent = getTextContent(currentElement);
              if (headerContent.trim()) {
                content.push(headerContent);
              }

              // Then get the content after the header
              currentElement = currentElement.nextElementSibling;

              // Collect content until the next header at the same or higher level
              while (
                currentElement &&
                (!nextHeaderForContent ||
                  currentElement !== nextHeaderForContent.element)
              ) {
                // Skip subsection headers as they'll be handled separately
                if (currentElement.matches("h1, h2, h3, h4, h5, h6")) {
                  const elementLevel = parseInt(currentElement.tagName[1]);
                  if (elementLevel > header.level) {
                    break;
                  }
                } else {
                  const text = getTextContent(currentElement);
                  if (text.trim()) {
                    content.push(text);
                  }
                }
                currentElement = currentElement.nextElementSibling;
              }

              // Create the section
              const section = {
                level: header.level,
                title: header.title,
                content: content.join("\\n\\n").trim(),
              };

              // Look for subsections
              if (
                i + 1 < headerPositions.length &&
                headerPositions[i + 1].level > header.level
              ) {
                const subsections = buildTree(i + 1, header.level + 1);
                if (subsections.length > 0) {
                  section.subsections = subsections;
                }
                // Skip past all the subsections we just processed
                while (
                  i + 1 < headerPositions.length &&
                  headerPositions[i + 1].level > header.level
                ) {
                  i++;
                }
              }

              sections.push(section);
              i++;
            }

            return sections;
          }

          // Handle content before first header
          const sections = [];
          let beforeFirstHeader = [];
          let currentElement = element.firstElementChild;

          while (
            currentElement &&
            !currentElement.matches("h1, h2, h3, h4, h5, h6")
          ) {
            const text = getTextContent(currentElement);
            if (text.trim()) {
              beforeFirstHeader.push(text);
            }
            currentElement = currentElement.nextElementSibling;
          }

          if (beforeFirstHeader.length > 0) {
            sections.push({
              level: 1,
              title: "Overview",
              content: beforeFirstHeader.join("\\n\\n").trim(),
            });
          }

          // Process all sections starting from the first header
          if (headerPositions.length > 0) {
            const minLevel = Math.min(...headerPositions.map((h) => h.level));
            const mainSections = buildTree(0, minLevel);
            sections.push(...mainSections);
          }

          return sections;
        }

        function extractNavigationStructure(element) {
          const items = [];
          const links = element.querySelectorAll("a");
          const seen = new Set();

          links.forEach((link) => {
            const text = link.textContent.trim();
            const url = link.getAttribute("href");
            const key = `${text}|${url}`;

            if (
              text &&
              url &&
              !seen.has(key) &&
              !text.includes("Current page is")
            ) {
              seen.add(key);
              items.push({ title: text, url: url });
            }
          });

          return items;
        }

        // Add link extraction
        function findDocumentationLinks(element) {
          const links = new Set();
          element.querySelectorAll("a").forEach((link) => {
            const href = link.getAttribute("href");
            // Only include links that are part of the documentation
            if (
              href &&
              href.includes("/documentation/markdownui/") &&
              !href.includes("#")
            ) {
              // Convert relative links to absolute
              const absoluteUrl = new URL(href, window.location.href).href;
              links.add(absoluteUrl);
            }
          });
          return Array.from(links);
        }

        const contentEl = document.querySelector(".content");
        const sidebarEl = document.querySelector(".sidebar");

        return {
          content: {
            title: document.title,
            mainContent: contentEl ? extractStructuredContent(contentEl) : [],
            navigation: sidebarEl ? extractNavigationStructure(sidebarEl) : [],
          },
          newUrls: [
            ...findDocumentationLinks(contentEl || document.body),
            ...findDocumentationLinks(sidebarEl || document.body),
          ],
        };
      }, baseUrl);

      // Post-process the content
      function redistributeContent(sections) {
        // Helper function to extract content block
        function extractContentBlock(content, sectionTitle) {
          // Escape special regex characters in the section title
          const escapedTitle = sectionTitle.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
          // Find the start of this section
          const startPattern = new RegExp(`\\[${escapedTitle}\\][^\\[]*`);
          const startMatch = content.match(startPattern);
          if (!startMatch) return [null, content];

          const startIndex = content.indexOf(startMatch[0]);
          const afterStart = content.slice(startIndex + startMatch[0].length);

          // Find the next section header at the same level
          const nextHeaderMatch = afterStart.match(
            /\[[^\]]+\](?=\(\/[^)]+#[^)]+\))/,
          );
          if (!nextHeaderMatch) {
            // No next header, take everything
            return [content.slice(startIndex), ""];
          }

          const endIndex = afterStart.indexOf(nextHeaderMatch[0]);
          const block = content.slice(
            startIndex,
            startIndex + startMatch[0].length + endIndex,
          );
          const remainingContent = content.slice(startIndex + block.length);

          return [block.trim(), remainingContent.trim()];
        }

        // Recursively redistribute content at each level
        function redistributeLevel(section) {
          if (section.subsections && section.subsections.length > 0) {
            // If this section has content and subsections, redistribute the content
            if (section.content) {
              let currentContent = section.content;
              section.subsections.forEach((subsection) => {
                const [block, remainingContent] = extractContentBlock(
                  currentContent,
                  subsection.title,
                );
                if (block) {
                  // Merge with any existing content
                  subsection.content = subsection.content
                    ? subsection.content + "\\n\\n" + block
                    : block;
                  currentContent = remainingContent;
                }
              });
              // Keep any unmatched content in the parent section
              section.content = currentContent;
            }

            // Recursively process each subsection
            section.subsections.forEach((subsection) => {
              redistributeLevel(subsection);
            });
          }
        }

        // Process all sections recursively
        sections.forEach((section) => redistributeLevel(section));

        return sections;
      }

      content.mainContent = redistributeContent(content.mainContent);

      // Generate a directory structure based on the URL path
      const urlPath = url.replace(baseUrl, "").split("/").filter(Boolean);
      let currentDir = "docs";

      // Create nested directories as needed
      for (const pathPart of urlPath.slice(0, -1)) {
        currentDir = path.join(currentDir, pathPart);
        if (!fs.existsSync(currentDir)) {
          fs.mkdirSync(currentDir);
        }
      }

      // Save the file in the appropriate directory
      const filename =
        urlPath.length > 0 ? urlPath[urlPath.length - 1] : "index";
      const filePath = path.join(currentDir, `${filename}.json`);

      await writeFile(
        filePath,
        JSON.stringify(
          {
            url,
            content,
          },
          null,
          2,
        ),
      );
      console.log(`Content saved to ${filePath}`);

      // Add new URLs to process
      newUrls.forEach((newUrl) => {
        if (!processedUrls.has(newUrl)) {
          urlsToProcess.push(newUrl);
        }
      });

      processedUrls.add(url);
      await page.close();

      // Small delay to avoid overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Create an index file with the structure
    const index = {
      baseUrl,
      pages: Array.from(processedUrls),
      structure: buildDirectoryStructure("docs"),
    };

    await writeFile("docs/index.json", JSON.stringify(index, null, 2));
    console.log(
      "Documentation crawling complete. Index saved to docs/index.json",
    );
  } catch (error) {
    console.error("Error during crawling:", error);
  } finally {
    await browser.close();
  }
}

// Helper function to build directory structure
function buildDirectoryStructure(dir) {
  const structure = {};
  const items = fs.readdirSync(dir);

  items.forEach((item) => {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      structure[item] = buildDirectoryStructure(fullPath);
    } else {
      structure[item] = null;
    }
  });

  return structure;
}

crawlWithCloudflareBypass().catch(console.error);
