import { Document, Packer, Paragraph, TextRun } from "docx";
import type { MessageAgentDraft, MessageAgentSourceRef } from "@harmonia/shared";

export async function buildMessageDraftDocx(input: { draft: MessageAgentDraft; sources: MessageAgentSourceRef[] }): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: `Subject: ${input.draft.subject}`, bold: true })] }),
    new Paragraph("")
  ];
  for (const line of input.draft.body.split(/\r?\n/)) {
    children.push(new Paragraph(line));
  }
  if (input.sources.length > 0) {
    children.push(new Paragraph(""));
    children.push(new Paragraph({ children: [new TextRun({ text: "Reference Sources", bold: true })] }));
    for (const source of input.sources) {
      children.push(new Paragraph(`- ${source.fileName} / ${source.title}`));
    }
  }
  const document = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(document));
}
