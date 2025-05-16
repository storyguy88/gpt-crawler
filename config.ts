import { Config } from "./src/config";

export const defaultConfig: Config = {
  url: [
    "https://platform.openai.com/docs/assistants/tools/file-search",
    "https://platform.openai.com/docs/guides/tools-file-search#upload-the-file-to-the-file-api",
    "https://platform.openai.com/docs/guides/retrieval",
  ],
  match: [],
  selector: `.docs-scroll-container`,
  maxPagesToCrawl: 20,
  outputFileName: "openai_tools_file_search_output.json",
  maxTokens: 2000000,
  waitForSelectorTimeout: 60000,
  resourceExclusions: ["image", "stylesheet", "media", "font", "other"],
};
