require('dotenv').config();
const axios = require('axios');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed',
        };
    }

    try {
        const { prompt } = JSON.parse(event.body);
        if (!prompt) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Prompt is required' }),
            };
        }

        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'API key is not configured on the server.' }),
            };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.4,
                topK: 1,
                topP: 1,
                maxOutputTokens: 2048,
            },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
            ]
        };

        const googleResponse = await axios.post(apiUrl, payload);
        const responseData = googleResponse.data;

        // API가 요청을 거부했는지 확인 (예: 안전 설정에 의해 차단)
        if (responseData.promptFeedback && responseData.promptFeedback.blockReason) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: `API 요청이 거부되었습니다. 이유: ${responseData.promptFeedback.blockReason}. 부적절한 단어가 포함되었는지 확인해주세요.` }),
            };
        }

        // API 응답에 유효한 콘텐츠가 있는지 확인
        const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            const finishReason = responseData.candidates?.[0]?.finishReason;
            if (finishReason && finishReason !== 'STOP') {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: `API가 응답 생성을 중단했습니다. 이유: ${finishReason}` }),
                };
            }
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "API로부터 유효한 텍스트 응답을 받지 못했습니다. 응답 형식을 확인해주세요." }),
            };
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(responseData),
        };

    } catch (error) {
        console.error('Netlify Function Error:', error);
        const errorMsg = error.response?.data?.error?.message || 'Failed to fetch from Google API';
        const statusCode = error.response?.status || 500;
        return {
            statusCode: statusCode,
            body: JSON.stringify({ error: errorMsg }),
        };
    }
};
