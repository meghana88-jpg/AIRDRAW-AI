
import {
    HandLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

// HTML elements
const video = document.getElementById("webcam");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const startCameraBtn = document.getElementById("startCamera");
const statusText = document.getElementById("status");

const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");

const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");

// AI and drawing variables
let handLandmarker;

let currentGesture = "NONE";
let candidateGesture = "NONE";
let gestureCount = 0;

let strokes = [];
let activeStroke = null;

let lastX = null;
let lastY = null;

let smoothX = null;
let smoothY = null;

// Initialize MediaPipe
async function initializeHandLandmarker() {

    statusText.innerText = "Loading AI hand detection...";

    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    handLandmarker = await HandLandmarker.createFromOptions(
        vision,
        {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
            },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.6
        }
    );
}

// Detect finger positions
function getFingerStates(landmarks) {

    const indexUp = landmarks[8].y < landmarks[6].y - 0.02;
    const middleUp = landmarks[12].y < landmarks[10].y - 0.02;
    const ringUp = landmarks[16].y < landmarks[14].y - 0.02;
    const pinkyUp = landmarks[20].y < landmarks[18].y - 0.02;

    return {
        indexUp,
        middleUp,
        ringUp,
        pinkyUp
    };
}

// Recognize hand gestures
function recognizeGesture(landmarks) {

    const fingers = getFingerStates(landmarks);

    // One finger = DRAW
    if (
        fingers.indexUp &&
        !fingers.middleUp &&
        !fingers.ringUp &&
        !fingers.pinkyUp
    ) {
        return "DRAW";
    }

    // Two fingers = MOVE
    if (
        fingers.indexUp &&
        fingers.middleUp &&
        !fingers.ringUp &&
        !fingers.pinkyUp
    ) {
        return "MOVE";
    }

    // Closed fist = ERASE
    if (
        !fingers.indexUp &&
        !fingers.middleUp &&
        !fingers.ringUp &&
        !fingers.pinkyUp
    ) {
        return "ERASE";
    }

    return "NONE";
}

// Stabilize gesture detection
function getStableGesture(newGesture) {

    if (newGesture === candidateGesture) {
        gestureCount++;
    } else {
        candidateGesture = newGesture;
        gestureCount = 1;
    }

    if (gestureCount >= 6 && currentGesture !== candidateGesture) {

        currentGesture = candidateGesture;

        // End previous drawing stroke
        activeStroke = null;

        lastX = null;
        lastY = null;

        smoothX = null;
        smoothY = null;
    }

    return currentGesture;
}

// Draw one line segment
function drawSegment(stroke, point1, point2) {

    ctx.save();

    if (stroke.type === "ERASE") {
        ctx.globalCompositeOperation = "destination-out";
    } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = stroke.color;
    }

    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(point1.x, point1.y);
    ctx.lineTo(point2.x, point2.y);
    ctx.stroke();

    ctx.restore();
}

// Redraw all saved strokes
function redrawCanvas() {

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokes) {

        for (let i = 1; i < stroke.points.length; i++) {

            drawSegment(
                stroke,
                stroke.points[i - 1],
                stroke.points[i]
            );
        }

        // Display a dot for a single-point stroke
        if (stroke.points.length === 1) {

            const point = stroke.points[0];

            ctx.save();

            if (stroke.type === "ERASE") {
                ctx.globalCompositeOperation = "destination-out";
            } else {
                ctx.fillStyle = stroke.color;
            }

            ctx.beginPath();
            ctx.arc(
                point.x,
                point.y,
                stroke.size / 2,
                0,
                Math.PI * 2
            );
            ctx.fill();

            ctx.restore();
        }
    }
}

// Handle drawing and erasing
function drawWithFinger(landmarks, gesture) {

    if (gesture !== "DRAW" && gesture !== "ERASE") {

        activeStroke = null;
        lastX = null;
        lastY = null;

        smoothX = null;
        smoothY = null;

        return;
    }

    const indexTip = landmarks[8];

    const rawX = (1 - indexTip.x) * canvas.width;
    const rawY = indexTip.y * canvas.height;

    // Smooth finger movement
    if (smoothX === null || smoothY === null) {
        smoothX = rawX;
        smoothY = rawY;
    } else {
        const smoothing = 0.35;

        smoothX += (rawX - smoothX) * smoothing;
        smoothY += (rawY - smoothY) * smoothing;
    }

    const x = smoothX;
    const y = smoothY;

    // Start a new stroke
    if (activeStroke === null) {

        activeStroke = {
            type: gesture,
            color: colorPicker.value,
            size: gesture === "ERASE"
                ? Number(brushSize.value) * 5
                : Number(brushSize.value),
            points: [{ x, y }]
        };

        strokes.push(activeStroke);

        lastX = x;
        lastY = y;

        redrawCanvas();

        return;
    }

    // Avoid adding tiny movements
    const distance = Math.hypot(
        x - lastX,
        y - lastY
    );

    if (distance < 2) {
        return;
    }

    const previousPoint = { x: lastX, y: lastY };
    const currentPoint = { x, y };

    activeStroke.points.push(currentPoint);

    drawSegment(
        activeStroke,
        previousPoint,
        currentPoint
    );

    lastX = x;
    lastY = y;
}

// Undo last stroke
undoBtn.addEventListener("click", () => {

    if (strokes.length > 0) {

        strokes.pop();

        activeStroke = null;

        lastX = null;
        lastY = null;

        smoothX = null;
        smoothY = null;

        currentGesture = "NONE";
        candidateGesture = "NONE";
        gestureCount = 0;

        redrawCanvas();

        statusText.innerText = "Last stroke undone!";

    } else {

        statusText.innerText = "Nothing to undo!";
    }
});

// Clear complete canvas
clearBtn.addEventListener("click", () => {

    strokes = [];
    activeStroke = null;

    lastX = null;
    lastY = null;

    smoothX = null;
    smoothY = null;

    currentGesture = "NONE";
    candidateGesture = "NONE";
    gestureCount = 0;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    statusText.innerText = "Canvas cleared!";
});

// Save drawing as PNG
saveBtn.addEventListener("click", () => {

    const link = document.createElement("a");

    link.download = "AirDraw-Drawing.png";
    link.href = canvas.toDataURL("image/png");

    link.click();

    statusText.innerText = "Drawing saved!";
});

// Detect hands
function detectHands() {

    if (!handLandmarker || video.readyState < 2) {
        requestAnimationFrame(detectHands);
        return;
    }

    const results = handLandmarker.detectForVideo(
        video,
        performance.now()
    );

    if (results.landmarks && results.landmarks.length > 0) {

        const landmarks = results.landmarks[0];

        const detectedGesture = recognizeGesture(landmarks);

        const gesture = getStableGesture(detectedGesture);

        drawWithFinger(landmarks, gesture);

        statusText.innerText = "Gesture: " + gesture;

    } else {

        currentGesture = "NONE";
        candidateGesture = "NONE";
        gestureCount = 0;

        activeStroke = null;

        lastX = null;
        lastY = null;

        smoothX = null;
        smoothY = null;

        statusText.innerText = "Show your hand to the camera";
    }

    requestAnimationFrame(detectHands);
}

// Start camera
startCameraBtn.addEventListener("click", async () => {

    try {

        startCameraBtn.disabled = true;

        await initializeHandLandmarker();

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: 1280,
                height: 720
            }
        });

        video.srcObject = stream;

        video.addEventListener("loadeddata", () => {

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            statusText.innerText = "Camera started! Show your hand.";

            detectHands();

        }, { once: true });

    } catch (error) {

        console.error(error);

        statusText.innerText = "Error: " + error.message;

        startCameraBtn.disabled = false;
    }
});
