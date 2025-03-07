// AssemblyAI + Claude Subtitle Generator
// This app uses AssemblyAI for transcription and Claude to improve subtitle phrasing

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// Initialize API keys
const assemblyApiKey = process.env.ASSEMBLY_API_KEY;
const claudeApiKey = process.env.CLAUDE_API_KEY;

// Main function to process a media file
async function generateImprovedSubtitles(filePath) {
  try {
    console.log(`Processing file: ${filePath}`);
    
    // Step 1: Upload and transcribe with AssemblyAI
    const transcriptionResult = await transcribeWithAssemblyAI(filePath);
    
    // Step 2: Convert AssemblyAI response to SRT format
    const rawSrt = convertToSRT(transcriptionResult);
    const outputRawPath = path.join(
      path.dirname(filePath), 
      `${path.basename(filePath, path.extname(filePath))}_raw.srt`
    );
    fs.writeFileSync(outputRawPath, rawSrt);
    console.log(`Raw SRT file saved to: ${outputRawPath}`);
    
    // Step 3: Improve phrasing with Claude
    const improvedSrt = await improvePhrasing(rawSrt);
    const outputImprovedPath = path.join(
      path.dirname(filePath), 
      `${path.basename(filePath, path.extname(filePath))}.srt`
    );
    fs.writeFileSync(outputImprovedPath, improvedSrt);
    console.log(`Improved SRT file saved to: ${outputImprovedPath}`);
    
    return {
      rawSrtPath: outputRawPath,
      improvedSrtPath: outputImprovedPath
    };
  } catch (error) {
    console.error('Error generating subtitles:', error);
    throw error;
  }
}

// Function to transcribe a file using AssemblyAI
async function transcribeWithAssemblyAI(filePath) {
  try {
    // Step 1: Upload the file to AssemblyAI
    const uploadUrl = await uploadFileToAssemblyAI(filePath);
    console.log('File uploaded to AssemblyAI');
    
    // Step 2: Submit transcription request
    const transcriptId = await submitTranscriptionJob(uploadUrl);
    console.log(`Transcription job submitted, ID: ${transcriptId}`);
    
    // Step 3: Poll for transcription completion
    const result = await pollForTranscriptionCompletion(transcriptId);
    console.log('Transcription completed successfully');
    
    return result;
  } catch (error) {
    console.error('Error in transcription process:', error);
    throw error;
  }
}

// Upload file to AssemblyAI
async function uploadFileToAssemblyAI(filePath) {
  const fileData = fs.readFileSync(filePath);
  const fileSize = fs.statSync(filePath).size;
  
  const response = await axios.post('https://api.assemblyai.com/v2/upload', fileData, {
    headers: {
      'authorization': assemblyApiKey,
      'content-type': 'application/octet-stream',
      'transfer-encoding': 'chunked'
    },
    maxBodyLength: fileSize + 100, // Add buffer for request overhead
  });
  
  return response.data.upload_url;
}

// Submit transcription job to AssemblyAI
async function submitTranscriptionJob(audioUrl) {
  const response = await axios.post('https://api.assemblyai.com/v2/transcript', {
    audio_url: audioUrl,
    speaker_labels: true,
    punctuate: true,
    format_text: true,
    dual_channel: false,
    word_boost: [],
    boost_param: "default",
    auto_highlights: true,
    entity_detection: true,
    disfluencies: false,
    sentiment_analysis: false,
    iab_categories: false,
    content_safety: false,
    language_code: "en"  // Change as needed for other languages
  }, {
    headers: {
      'authorization': assemblyApiKey,
      'content-type': 'application/json'
    }
  });
  
  return response.data.id;
}

// Poll for transcription job completion
async function pollForTranscriptionCompletion(transcriptId) {
  let completed = false;
  let result = null;
  
  while (!completed) {
    const response = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: {
        'authorization': assemblyApiKey
      }
    });
    
    const transcriptionStatus = response.data.status;
    
    if (transcriptionStatus === 'completed') {
      completed = true;
      result = response.data;
    } else if (transcriptionStatus === 'error') {
      throw new Error(`Transcription error: ${response.data.error}`);
    } else {
      // Wait for 3 seconds before checking again
      console.log(`Transcription status: ${transcriptionStatus}, waiting...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  return result;
}

// Convert AssemblyAI JSON response to SRT format
function convertToSRT(transcriptionResult) {
  let srtContent = '';
  let index = 1;
  
  // Check if we have words with timestamps
  if (transcriptionResult.words && transcriptionResult.words.length > 0) {
    // Group words into sentences or manageable chunks
    const chunks = groupWordsIntoChunks(transcriptionResult.words);
    
    chunks.forEach(chunk => {
      const startTime = formatSRTTime(chunk.start);
      const endTime = formatSRTTime(chunk.end);
      
      srtContent += `${index}\n`;
      srtContent += `${startTime} --> ${endTime}\n`;
      srtContent += `${chunk.text}\n\n`;
      
      index++;
    });
  } else if (transcriptionResult.utterances) {
    // Use utterances if available (for speaker separation)
    transcriptionResult.utterances.forEach(utterance => {
      const startTime = formatSRTTime(utterance.start);
      const endTime = formatSRTTime(utterance.end);
      
      const speakerPrefix = utterance.speaker ? `Speaker ${utterance.speaker}: ` : '';
      
      srtContent += `${index}\n`;
      srtContent += `${startTime} --> ${endTime}\n`;
      srtContent += `${speakerPrefix}${utterance.text}\n\n`;
      
      index++;
    });
  } else {
    // Fallback to using sentences or the full transcript
    const sentences = transcriptionResult.text.match(/[^.!?]+[.!?]+/g) || [transcriptionResult.text];
    
    // Since we don't have word-level timestamps in this fallback, we'll distribute evenly
    const duration = transcriptionResult.audio_duration || 0;
    const timePerSentence = duration / sentences.length;
    
    sentences.forEach((sentence, i) => {
      const startTime = formatSRTTime(i * timePerSentence);
      const endTime = formatSRTTime((i + 1) * timePerSentence);
      
      srtContent += `${index}\n`;
      srtContent += `${startTime} --> ${endTime}\n`;
      srtContent += `${sentence.trim()}\n\n`;
      
      index++;
    });
  }
  
  return srtContent;
}

// Helper function to group words into meaningful chunks (sentences or phrases)
function groupWordsIntoChunks(words) {
  const chunks = [];
  let currentChunk = { text: '', start: words[0].start, end: words[0].end, words: [] };
  let wordCount = 0;
  let lastPunctuation = 0;
  
  words.forEach((word, index) => {
    // Add word to current chunk
    currentChunk.words.push(word);
    currentChunk.text += (wordCount > 0 ? ' ' : '') + word.text;
    currentChunk.end = word.end;
    wordCount++;
    
    const isEndOfSentence = /[.!?]$/.test(word.text);
    const isPunctuation = /[,;:]$/.test(word.text);
    
    if (isPunctuation) {
      lastPunctuation = wordCount;
    }
    
    // Conditions to create a new chunk:
    // 1. End of a sentence
    // 2. Reached reasonable length (13-15 words) with a comma/semicolon in the last few words
    // 3. Reached maximum length (20 words)
    if (
      isEndOfSentence || 
      (wordCount >= 13 && wordCount - lastPunctuation <= 5 && lastPunctuation > 0) ||
      wordCount >= 20
    ) {
      // Save current chunk
      chunks.push({ ...currentChunk });
      
      // Start a new chunk if there are more words
      if (index < words.length - 1) {
        const nextWord = words[index + 1];
        currentChunk = { text: '', start: nextWord.start, end: nextWord.end, words: [] };
        wordCount = 0;
        lastPunctuation = 0;
      }
    }
  });
  
  // Add the last chunk if it has content and wasn't added yet
  if (currentChunk.text && chunks[chunks.length - 1] !== currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

// Format milliseconds to SRT timestamp format (HH:MM:SS,MMM)
function formatSRTTime(milliseconds) {
  if (typeof milliseconds !== 'number') {
    return '00:00:00,000';
  }
  
  const totalSeconds = Math.floor(milliseconds / 1000);
  const ms = Math.floor(milliseconds % 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)},${padZero(ms, 3)}`;
}

// Pad numbers with leading zeros
function padZero(num, length = 2) {
  return num.toString().padStart(length, '0');
}

// Use Claude to improve phrasing breaks in SRT using direct API call
async function improvePhrasing(srtContent) {
  try {
    console.log('Sending SRT to Claude for improvement...');
    
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: "claude-3-sonnet-20240229",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: `I have an SRT subtitle file that needs improvement with better phrasing breaks. Please analyze this subtitle file and improve it by:

1. Ensuring subtitle breaks occur at natural pauses in speech
2. Keeping each subtitle to 1-2 lines maximum (about 42 characters per line)
3. Maintaining proper sentence structure and meaning
4. Avoiding breaking subtitles in the middle of a grammatical clause when possible
5. Preserving all original timing information
6. Returning only the improved SRT file with no explanations

Here's the SRT file:

${srtContent}`
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01'
        }
      }
    );
    
    // Extract the improved SRT content from Claude's response
    const improvedSrt = response.data.content[0].text;
    console.log('Claude has improved the SRT file');
    
    return improvedSrt;
  } catch (error) {
    console.error('Error improving phrasing with Claude:', error);
    // In case of error, return the original SRT content
    return srtContent;
  }
}

// Command line interface for the app
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node subtitle-generator.js <path-to-media-file>');
    process.exit(1);
  }
  
  const filePath = args[0];
  
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  
  generateImprovedSubtitles(filePath)
    .then(result => {
      console.log('\nSubtitle generation completed successfully!');
      console.log(`Raw SRT: ${result.rawSrtPath}`);
      console.log(`Improved SRT: ${result.improvedSrtPath}`);
    })
    .catch(error => {
      console.error('Failed to generate subtitles:', error);
      process.exit(1);
    });
} else {
  // Export functions for use as a module
  module.exports = {
    generateImprovedSubtitles,
    transcribeWithAssemblyAI,
    convertToSRT,
    improvePhrasing
  };
}
