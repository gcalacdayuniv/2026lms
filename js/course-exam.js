// js/course-exam.js
import { apiFetch } from './globals.js';

export const CourseExam = {
    courseId: null,
    exams: [],
    
    // Presentation State
    quizData: [],
    current: 0,
    revealed: false,
    zoom: 1,
    parts: ["Part I: Multiple Choice", "Part II: True or False", "Part III: Enumeration"],
    tfOptions: ["True", "False"],

    init: () => {
        document.addEventListener('click', CourseExam.handleClicks);
        document.addEventListener('keydown', CourseExam.handleKeydown);
    },

    handleClicks: async (e) => {
        if (e.target.closest('#openExamManagerBtn')) {
            document.getElementById('courseMenuModal')?.classList.add('hidden');
            document.getElementById('examManagerModal').classList.remove('hidden');
            CourseExam.courseId = window.location.hash.replace('#class-', '');
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
            const data = await apiFetch(`/api/exams?courseId=${CourseExam.courseId}&_t=${ts}`);
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

    parseCSVLine: (text) => {
        let result = [], cur = '', inQuote = false;
        for(let i=0; i<text.length; i++){
            if(text[i] === '"') inQuote = !inQuote;
            else if(text[i] === ',' && !inQuote) { result.push(cur); cur = ''; }
            else cur += text[i];
        }
        result.push(cur);
        return result.map(s => s.trim());
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
                const lines = text.split('\n');
                const examData = [];

                for (let i = 1; i < lines.length; i++) {
                    const lineStr = lines[i].trim();
                    if (!lineStr) continue;
                    const row = CourseExam.parseCSVLine(lineStr);
                    if (row.length < 4) continue;
                    
                    const part = parseInt(row[0]);
                    const question = row[1];
                    const choices = row[2] ? row[2].split('|').map(c => c.trim()) : [];
                    const answer = row[3];
                    const expl = row[4] || "";
                    
                    examData.push([part, question, choices, answer, expl]);
                }

                await apiFetch('/api/exams', {
                    method: 'POST',
                    body: JSON.stringify({
                        courseId: CourseExam.courseId,
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
        CourseExam.parts.forEach((name, p) => {
            const b = document.createElement("button");
            b.className = "exam-tab";
            b.textContent = name;
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
        
        [...choicesEl.children].forEach((el, i) => {
            el.classList.toggle("correct", show && choices[i] === ans);
            el.classList.toggle("dim", show && choices[i] !== ans);
        });
        
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
        [...tabsEl.children].forEach((t, i) => t.classList.toggle("active", i === part));
        
        const counterEl = document.getElementById('examCounter');
        counterEl.innerHTML = `<span class="num">${CourseExam.current + 1}</span><span class="of">of ${total} &nbsp;|&nbsp; ${posInPart} of ${inPart.length} in this part</span>`;
        
        document.getElementById('examQuestion').textContent = q;

        const choicesEl = document.getElementById('examChoices');
        choicesEl.innerHTML = "";
        
        const isTF = choices.length === 2 && choices[0] === "True" && choices[1] === "False";
        choicesEl.className = "exam-choices" + (isTF ? " two" : "");
        
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
