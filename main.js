// DOM 요소 가져오기
        const searchInput = document.getElementById('searchInput');
        const searchButton = document.getElementById('searchButton');
        const errorContainer = document.getElementById('errorContainer');
        const loader = document.getElementById('loader');
        const peopleCards = document.getElementById('peopleCards');
        const differenceCard = document.getElementById('differenceCard');
        const usageGuide = document.getElementById('usageGuide');

        // 이벤트 리스너
        searchButton.addEventListener('click', handleSearch);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSearch();
        });

        /**
         * 메인 검색 처리 함수
         */
        async function handleSearch() {
            const query = searchInput.value.trim();
            if (!query) {
                displayError('검색할 인물 이름을 입력해주세요.');
                return;
            }

            toggleLoading(true);
            clearResults();
            
            try {
                // Gemini API에 보낼 프롬프트 (성별 정보 요청 추가)
                const prompt = `
                    다음 인물들의 정보를 조사해서 JSON 형태로 정확하게 응답해주세요:
                    검색할 인물: "${query}"

                    다음 JSON 형식으로만 응답해주세요:
                    {
                      "people": [
                        {
                          "name": "실제 이름",
                          "birthDate": "YYYY-MM-DD",
                          "gender": "성별 (남성/여성)",
                          "description": "간단한 설명 (직업, 주요 활동 등 1~2문장)"
                        }
                      ]
                    }

                    중요한 규칙:
                    - 요청된 모든 인물에 대해 정보를 제공해야 합니다. 만약 특정 인물의 정보를 찾을 수 없다면, 해당 인물의 이름만 포함하고 나머지 필드는 비워두세요.
                    - 실제 존재하는 인물만 포함해주세요.
                    - 생년월일은 반드시 'YYYY-MM-DD' 형식으로 제공해주세요.
                    - 성별은 '남성' 또는 '여성'으로 표기해주세요.
                    - 불확실한 정보는 포함하지 마세요.
                    - 응답은 JSON 형식 외의 다른 텍스트(설명, 인사 등)를 절대 포함하면 안 됩니다.
                    - 백틱(\u0060\u0060\u0060)이나 'json' 같은 마크다운 지시어를 사용하지 마세요.
                    - 검색할 인물이 여러 명인 경우, 쉼표로 구분된 각 인물에 대해 개별적으로 정보를 찾아주세요.
                `;

                // 서버와 동일한 출처를 사용하므로 상대 경로로 변경
                const apiUrl = '/api/generate';
                
                // 서버에 prompt만 담아서 전송
                const payload = { prompt };
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    // 서버에서 보낸 구체적인 에러 메시지를 확인합니다.
                    let errorMessage = `API 요청 실패: ${response.status}`;
                    try {
                        // 백엔드에서 보낸 JSON 에러 응답을 파싱합니다.
                        const errorData = await response.json();
                        if (errorData && errorData.error) {
                            errorMessage = `오류: ${errorData.error}`;
                        }
                    } catch (e) { /* JSON 파싱 실패는 무시 */ }
                    throw new Error(errorMessage);
                }

                const result = await response.json();
                
                // 1. API가 요청을 거부했는지 확인 (예: 안전 설정에 의해 차단)
                if (result.promptFeedback && result.promptFeedback.blockReason) {
                    const reason = result.promptFeedback.blockReason;
                    throw new Error(`API 요청이 거부되었습니다. 이유: ${reason}. 부적절한 단어가 포함되었는지 확인해주세요.`);
                }

                // 2. API 응답에 유효한 콘텐츠가 있는지 확인
                const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!text) {
                    const finishReason = result.candidates?.[0]?.finishReason;
                    if (finishReason && finishReason !== 'STOP') {
                        throw new Error(`API가 응답 생성을 중단했습니다. 이유: ${finishReason}`);
                    }
                    throw new Error("API로부터 유효한 텍스트 응답을 받지 못했습니다. 응답 형식을 확인해주세요.");
                }
                
                const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsedResponse = JSON.parse(cleanText);
                
                if (!parsedResponse.people || parsedResponse.people.length === 0) {
                    displayError('검색 결과를 찾을 수 없습니다. 인물 이름을 다시 확인해주세요.');
                    return;
                }
                processAndRenderResults(parsedResponse.people);

            } catch (err) {
                console.error('검색 오류:', err);
                displayError(`검색 중 오류가 발생했습니다: ${err.message}`);
            } finally {
                toggleLoading(false);
            }
        }

        /**
         * 결과 데이터를 처리하고 화면에 렌더링
         */
        function processAndRenderResults(people) {
            const processedResults = people.map(person => ({
                ...person,
                age: calculateInternationalAge(person.birthDate),
            })).sort((a, b) => new Date(a.birthDate) - new Date(b.birthDate));

            peopleCards.innerHTML = processedResults.map(createPersonCard).join('');

            if (processedResults.length === 2) {
                const olderPerson = processedResults[0];
                const youngerPerson = processedResults[1];
                const difference = calculateAgeDifference(olderPerson.birthDate, youngerPerson.birthDate);
                const relationship = getRelationship(olderPerson, youngerPerson);
                differenceCard.innerHTML = createDifferenceCard(difference, relationship);
            } else {
                differenceCard.innerHTML = '';
            }
        }
        
        /**
         * 두 인물의 관계를 성별에 따라 구체적으로 설명
         * @param {Object} olderPerson - 나이가 많은 사람
         * @param {Object} youngerPerson - 나이가 적은 사람
         * @returns {string} - 관계 설명 문자열
         */
        function getRelationship(olderPerson, youngerPerson) {
            const olderBirthYear = new Date(olderPerson.birthDate).getFullYear();
            const youngerBirthYear = new Date(youngerPerson.birthDate).getFullYear();

            // 출생 연도가 같으면 '친구'로 처리
            if (olderBirthYear === youngerBirthYear) {
                return `${olderPerson.name}님과 ${youngerPerson.name}님은 <strong>친구</strong>입니다.`;
            }

            // 성별 정보가 둘 다 있어야 관계를 정확히 추정할 수 있습니다.
            if (!youngerPerson.gender || !olderPerson.gender) {
                 return `${olderPerson.name}님이 ${youngerPerson.name}님보다 나이가 많습니다.`;
            }

            let relationshipTerm = '';
            // youngerPerson의 관점에서 olderPerson을 부르는 호칭 결정
            if (youngerPerson.gender === '남성') {
                relationshipTerm = olderPerson.gender === '남성' ? '형' : '누나';
            } else if (youngerPerson.gender === '여성') {
                relationshipTerm = olderPerson.gender === '남성' ? '오빠' : '언니';
            }

            return `${olderPerson.name}님은 ${youngerPerson.name}님의 <strong>${relationshipTerm}</strong>입니다.`;
        }

        // --- 카드 생성 및 계산 함수 ---

        /**
         * 만나이를 계산합니다.
         * @param {string} birthDate - 'YYYY-MM-DD' 형식의 생년월일
         * @returns {number} - 만나이
         */
        function calculateInternationalAge(birthDate) {
            const today = new Date();
            const birth = new Date(birthDate);
            let age = today.getFullYear() - birth.getFullYear();
            const monthDiff = today.getMonth() - birth.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
                age--;
            }
            return age;
        }

        /**
         * 한국 나이를 계산합니다.
         * @param {string} birthDate - 'YYYY-MM-DD' 형식의 생년월일
         * @returns {number} - 한국 나이
         */
        function calculateKoreanAge(birthDate) {
            const today = new Date();
            const birth = new Date(birthDate);
            return today.getFullYear() - birth.getFullYear() + 1;
        }

        function createPersonCard(person) {
            const internationalAge = calculateInternationalAge(person.birthDate);
            const koreanAge = calculateKoreanAge(person.birthDate);
            return `
                <div class="bg-white rounded-xl shadow-lg p-6 transition-transform duration-300 hover:scale-105">
                    <div class="flex items-center mb-4">
                        <div class="p-2 bg-blue-100 rounded-full mr-4">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-8 w-8 text-blue-600"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        </div>
                        <h3 class="text-2xl font-bold text-gray-800">${person.name}</h3>
                    </div>
                    <div class="space-y-3 text-gray-700">
                        <div class="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 text-gray-500 mr-3"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            <span>${person.birthDate}</span>
                        </div>
                        <div class="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 text-gray-500 mr-3"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            <span class="font-bold text-lg text-blue-600">만 ${internationalAge}세 (한국 나이 ${koreanAge}세)</span>
                        </div>
                        <p class="text-sm text-gray-600 pt-2 border-t mt-3">
                            ${person.description}
                        </p>
                    </div>
                </div>
            `;
        }

        function createDifferenceCard(difference, relationship) {
            return `
                <div class="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl shadow-lg p-6 text-center">
                    <h3 class="text-xl font-bold mb-3">${relationship}</h3>
                    <div class="flex items-center justify-center text-lg space-x-4">
                        <span>나이 차이:</span>
                        <p class="text-3xl font-bold">
                            ${difference.years > 0 ? `${difference.years}년 ` : ''} 
                            ${difference.months > 0 ? `${difference.months}개월` : ''}
                        </p>
                    </div>
                    <p class="text-sm opacity-80 mt-2">(총 ${difference.totalDays.toLocaleString()}일 차이)</p>
                </div>
            `;
        }
        
        function calculateAgeDifference(birthDate1, birthDate2) {
            const date1 = new Date(birthDate1);
            const date2 = new Date(birthDate2);
            const diffTime = Math.abs(date2 - date1);
            const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            let olderDate = date1 < date2 ? date1 : date2;
            let youngerDate = date1 < date2 ? date2 : date1;

            let years = youngerDate.getFullYear() - olderDate.getFullYear();
            let months = youngerDate.getMonth() - olderDate.getMonth();
            
            if (youngerDate.getDate() < olderDate.getDate()) {
                months--;
            }
            if (months < 0) {
                years--;
                months += 12;
            }
            return { years, months, totalDays };
        }

        function toggleLoading(isLoading) {
            searchButton.disabled = isLoading;
            loader.style.display = isLoading ? 'flex' : 'none';
            if (isLoading) usageGuide.style.display = 'none';
        }

        function displayError(message) {
            errorContainer.textContent = message;
            errorContainer.style.display = 'block';
        }

        function clearResults() {
            errorContainer.style.display = 'none';
            peopleCards.innerHTML = '';
            differenceCard.innerHTML = '';
        }