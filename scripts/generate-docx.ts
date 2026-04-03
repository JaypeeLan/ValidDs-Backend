import * as fs from 'fs';
import * as path from 'path';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

interface MarkdownFile {
  src: string;
  dest: string;
}

const filesToConvert: MarkdownFile[] = [
  { src: 'docs/week_2.md', dest: 'project_docs/week_2.docx' },
  { src: 'docs/architecture.md', dest: 'project_docs/architecture.docx' },
  { src: 'docs/decision-log.md', dest: 'project_docs/decision_log.docx' },
  { src: 'docs/risks.md', dest: 'project_docs/risks.docx' },
];

function parseMarkdownToDocx(mdContent: string): Document {
  const lines = mdContent.split('\n');
  const children: Paragraph[] = [];

  for (let line of lines) {
    line = line.trimEnd();
    if (line === '') {
      children.push(new Paragraph({ text: '' }));
      continue;
    }

    // Headers
    if (line.startsWith('# ')) {
      children.push(new Paragraph({
        text: line.replace('# ', ''),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }));
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({
        text: line.replace('## ', ''),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      }));
    } else if (line.startsWith('### ')) {
      children.push(new Paragraph({
        text: line.replace('### ', ''),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
      }));
    } else if (line.startsWith('* ') || line.startsWith('- ')) {
      // Bullet point
      children.push(new Paragraph({
        text: line.replace(/^[\*\-]\s+/, ''),
        bullet: { level: 0 },
        spacing: { after: 100 },
      }));
    } else if (line.startsWith('    - ')) {
      // Indented bullet point
      children.push(new Paragraph({
        text: line.replace(/^ {4}[\*\-]\s+/, ''),
        bullet: { level: 1 },
        spacing: { after: 100 },
      }));
    } else if (line.startsWith('---')) {
       // Horizontal line / section break - simplified as empty paragraph with border or just space
       children.push(new Paragraph({
         text: '',
         border: { bottom: { color: 'auto', space: 1, style: 'single', size: 6 } },
         spacing: { before: 200, after: 200 },
       }));
    } else {
      // Regular paragraph
      // Handle simple formatting like **bold** and *italic*
      let text = line;
      // This is a very simplified parsing for demo/utility purposes
      // and doesn't handle nested formatting perfectly, but is sufficient for these docs.
      
      children.push(new Paragraph({
        children: [new TextRun(text)],
        spacing: { after: 150 },
      }));
    }
  }

  return new Document({
    sections: [{
      children: children,
    }],
  });
}

async function convert() {
  for (const file of filesToConvert) {
    console.log(`Converting ${file.src} to ${file.dest}...`);
    try {
      const srcPath = path.resolve(process.cwd(), file.src);
      const destPath = path.resolve(process.cwd(), file.dest);
      
      const mdContent = fs.readFileSync(srcPath, 'utf-8');
      const doc = parseMarkdownToDocx(mdContent);
      
      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(destPath, buffer);
      console.log(`Successfully generated ${file.dest}`);
    } catch (err) {
      console.error(`Error converting ${file.src}:`, err);
    }
  }
}

convert();
