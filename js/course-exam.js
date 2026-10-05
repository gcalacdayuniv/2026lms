// js/course-exam.js
import { apiFetch, AppState } from './globals.js';

export const CourseExam = {
    exams: [],
    
    // Presentation State
    quizData: [],
    current: 0,
    revealed: false,
    zoom: 1,

    init: () => {
        document.addEventListener('click', CourseExam.handleClicks);
        document.addEventListener('keydown', CourseExam.handleKeydown);
    },

    handleClicks: async (e) => {
        if (e.target.closest('#openExamManagerBtn')) {
            document.getElementById('courseMenuModal')?.classList.add('hidden');
            document.getElementById('examManagerModal').classList.remove('hidden');
            await CourseExam.loadExams();
        }

        if (e.target.closest('#closeExamManagerBtn') || e.target.id === 'closeExamManagerBg') {
            document.getElementById('examManagerModal').classList.add('hidden');
        }

        if (e.target.closest('#uploadExamBtn')) {
            await CourseExam.uploadCsv();
        }

        if (e.target.closest('.present-exam-btn')) {
            const btn = e.target.closest('.present-exam-btn');
            await CourseExam.startPresentation(btn.dataset.examId, btn.dataset.title);
        }

        if (e.target.closest('#closeExamPresentationBtn')) {
            document.getElementById('examPresentationOverlay').classList.add('hidden');
        }

        // Presentation Navigations
        if (e.target.closest('#examPrevBtn')) CourseExam.navigate(-1);
        if (e.target.closest('#examNextBtn')) CourseExam.navigate(1);
        if (e.target.closest('#examRevealBtn')) CourseExam.toggleAnswer();
        if (e.target.closest('#examRestartBtn')) CourseExam.restart();
    },

    handleKeydown: (e) => {
        const overlay = document.getElementById('examPresentationOverlay');
        if (!overlay || overlay.classList.contains('hidden')) return;

        if (e.key === "Home") CourseExam.restart();
        else if (e.key === "ArrowRight") CourseExam.navigate(1);
        else if (e.key === "ArrowLeft") CourseExam.navigate(-1);
        else if (e.key === " " && document.activeElement.tagName !== "BUTTON") { 
            e.preventDefault(); 
            CourseExam.toggleAnswer(); 
        }
    },

    loadExams: async () => {
        const container = document.getElementById('examListContainer');
        container.innerHTML = '<div class="text-center py-6 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';
        
        try {
            const ts = new Date().getTime();
            const lecturerId = AppState.user.User_ID;
            const data = await apiFetch(`/api/exams?lecturerId=${lecturerId}&_t=${ts}`);
            CourseExam.exams = data.exams || [];
            
            if (CourseExam.exams.length === 0) {
                container.innerHTML = '<div class="text-sm text-gray-500 italic text-center py-6">No exams uploaded yet.</div>';
                return;
            }

            container.innerHTML = CourseExam.exams.map(ex => `
                <div class="flex justify-between items-center bg-white p-3 border border-gray-200 rounded shadow-sm hover:border-blue-300 transition">
                    <span class="font-bold text-gray-800 text-sm">${ex.Title}</span>
                    <button type="button" class="present-exam-btn bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 px-4 py-1.5 rounded text-xs font-bold transition shadow-sm" data-exam-id="${ex.Exam_ID}" data-title="${ex.Title}">
                        <i class="fa-solid fa-play mr-1"></i> Present
                    </button>
                </div>
            `).join('');

        } catch (err) {
            container.innerHTML = `<div class="text-red-500 font-bold text-sm text-center py-4">${err.message}</div>`;
        }
    },

    // Robust CSV parser supporting line breaks within quotes
    parseCSV: (str) => {
        const arr = [];
        let quote = false;
        let row = 0, col = 0;
        for (let c = 0; c < str.length; c++) {
            let cc = str[c], nc = str[c+1];
            arr[row] = arr[row] || [];
            arr[row][col] = arr[row][col] || '';
            
            if (cc === '"' && quote && nc === '"') { arr[row][col] += cc; ++c; continue; }
            if (cc === '"') { quote = !quote; continue; }
            if (cc === ',' && !quote) { ++col; continue; }
            if (cc === '\r' && nc === '\n' && !quote) { ++row; col = 0; ++c; continue; }
            if (cc === '\n' && !quote) { ++row; col = 0; continue; }
            if (cc === '\r' && !quote) { ++row; col = 0; continue; }
            arr[row][col] += cc;
        }
        return arr.map(r => r.map(c => c.trim()));
    },

    uploadCsv: async () => {
        const titleInput = document.getElementById('newExamTitle');
        const fileInput = document.getElementById('examCsvUpload');
        const msgDiv = document.getElementById('examUploadMessage');
        const btn = document.getElementById('uploadExamBtn');

        if (!titleInput.value.trim() || !fileInput.files.length) {
            msgDiv.textContent = "Please provide a title and select a CSV file.";
            msgDiv.className = "mt-2 text-xs font-bold p-2 rounded bg-red-100 text-red-700 block";
            return;
        }

        const file = fileInput.files[0];
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                const rows = CourseExam.parseCSV(text);
                const examData = [];

                // Skip header row
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.length < 4 || row.every(col => col === "")) continue;
                    
                    const part = parseInt(row[0]);
                    const question = row[1];
                    const choicesStr = row[2] ? row[2].trim() : "";
                    const choices = choicesStr ? choicesStr.split('|').map(c => c.trim()) : [];
                    const answer = row[3];
                    const expl = row[4] || "";
                    
                    examData.push([part, question, choices, answer, expl]);
                }

                if (examData.length === 0) throw new Error("No valid questions found in CSV.");

                await apiFetch('/api/exams', {
                    method: 'POST',
                    body: JSON.stringify({
                        lecturerId: AppState.user.User_ID,
                        title: titleInput.value.trim(),
                        examData: examData
                    })
                });

                msgDiv.textContent = "Exam uploaded successfully.";
                msgDiv.className = "mt-2 text-xs font-bold p-2 rounded bg-green-100 text-green-700 block";
                titleInput.value = '';
                fileInput.value = '';
                await CourseExam.loadExams();
            } catch (err) {
                msgDiv.textContent = err.message;
                msgDiv.className = "mt-2 text-xs font-bold p-2 rounded bg-red-100 text-red-700 block";
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Upload';
                setTimeout(() => msgDiv.classList.add('hidden'), 3000);
            }
        };
        reader.readAsText(file);
    },

    startPresentation: async (examId, title) => {
        document.getElementById('examManagerModal').classList.add('hidden');
        const overlay = document.getElementById('examPresentationOverlay');
        document.getElementById('examPresentationTitle').textContent = title;
        overlay.classList.remove('hidden');

        try {
            const data = await apiFetch(`/api/exam-data?examId=${examId}`);
            CourseExam.quizData = JSON.parse(data.exam.ExamData);
            CourseExam.current = 0;
            CourseExam.revealed = false;
            CourseExam.buildTabs();
            CourseExam.render();
        } catch (err) {
            alert("Failed to load exam data: " + err.message);
            overlay.classList.add('hidden');
        }
    },

    buildTabs: () => {
        const tabsEl = document.getElementById('examTabs');
        tabsEl.innerHTML = '';
        
        // Dynamically find all unique Part Indexes from the uploaded data
        const uniqueParts = [...new Set(CourseExam.quizData.map(d => d[0]))].sort((a, b) => a - b);
        
        uniqueParts.forEach((p) => {
            const b = document.createElement("button");
            b.className = "exam-tab";
            b.textContent = `Part ${p + 1}`;
            b.onclick = () => { 
                const idx = CourseExam.quizData.findIndex(d => d[0] === p);
                if (idx !== -1) {
                    CourseExam.current = idx; 
                    CourseExam.revealed = false; 
                    CourseExam.render(); 
                }
            };
            tabsEl.appendChild(b);
        });
    },

    setAnswer: (show) => {
        CourseExam.revealed = show;
        if (!CourseExam.quizData[CourseExam.current]) return;
        const [, , choices, ans] = CourseExam.quizData[CourseExam.current];
        
        const answerEl = document.getElementById('examAnswer');
        const revealBtn = document.getElementById('examRevealBtn');
        const choicesEl = document.getElementById('examChoices');

        answerEl.classList.toggle("open", show);
        revealBtn.textContent = show ? "Hide answer" : "Show answer";
        
        // Handle Highlighting Only if Choices Exist
        if (choices && choices.length > 0) {
            [...choicesEl.children].forEach((el, i) => {
                el.classList.toggle("correct", show && choices[i] === ans);
                el.classList.toggle("dim", show && choices[i] !== ans);
            });
        }
        
        if (show) answerEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },

    toggleAnswer: () => { 
        CourseExam.setAnswer(!CourseExam.revealed); 
    },

    navigate: (dir) => {
        const total = CourseExam.quizData.length;
        CourseExam.current = Math.min(total - 1, Math.max(0, CourseExam.current + dir));
        CourseExam.render();
    },

    restart: () => { 
        CourseExam.current = 0; 
        CourseExam.render(); 
    },

    render: () => {
        if (!CourseExam.quizData || CourseExam.quizData.length === 0) return;
        
        const dataRow = CourseExam.quizData[CourseExam.current];
        const part = dataRow[0];
        const q = dataRow[1];
        const choices = dataRow[2] || [];
        const ans = dataRow[3];
        const expl = dataRow[4];

        const total = CourseExam.quizData.length;
        const inPart = CourseExam.quizData.filter(d => d[0] === part);
        const posInPart = CourseExam.quizData.slice(0, CourseExam.current + 1).filter(d => d[0] === part).length;

        const tabsEl = document.getElementById('examTabs');
        [...tabsEl.children].forEach((t) => {
            const targetPart = parseInt(t.textContent.replace('Part ', '')) - 1;
            t.classList.toggle("active", targetPart === part);
        });
        
        const counterEl = document.getElementById('examCounter');
        counterEl.innerHTML = `<span class="num">${CourseExam.current + 1}</span><span class="of">of ${total} &nbsp;|&nbsp; ${posInPart} of ${inPart.length} in this part</span>`;
        
        document.getElementById('examQuestion').textContent = q;

        const choicesEl = document.getElementById('examChoices');
        choicesEl.innerHTML = "";
        
        let choicesClass = "exam-choices";
        if (choices.length === 2) choicesClass += " two";
        else if (choices.length >= 6) choicesClass += " many";
        choicesEl.className = choicesClass;
        
        // Will remain completely empty & cleanly hidden for Identification types
        choices.forEach(c => {
            const div = document.createElement("div");
            div.className = "exam-choice";
            div.textContent = c;
            choicesEl.appendChild(div);
        });

        const answerEl = document.getElementById('examAnswer');
        const explanationHTML = expl ? `<div class="exam-expl">${expl}</div>` : "";
        answerEl.innerHTML = `<span class="label">Answer</span>${ans}${explanationHTML}`;
        
        document.getElementById('examBar').style.width = ((CourseExam.current + 1) / total * 100) + "%";
        document.getElementById('examPrevBtn').disabled = CourseExam.current === 0;
        document.getElementById('examNextBtn').disabled = CourseExam.current === total - 1;
        
        CourseExam.setAnswer(false);
        document.getElementById('examBodyEl').scrollTop = 0;
    }
};
