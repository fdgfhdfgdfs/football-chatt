import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import "./styles.css";

const generateRoomCode = () =>
  Math.random().toString(36).substring(2, 6).toUpperCase();

export default function App() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [roomInfo, setRoomInfo] = useState(null);
  const [players, setPlayers] = useState([]);
  const [usedPoints, setUsedPoints] = useState([]);

  const [questionInput, setQuestionInput] = useState("");
  const [answerInput, setAnswerInput] = useState("");
  const [selectedBet, setSelectedBet] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);

  // دالة مزامنة الوقت الحقيقي بناءً على توقيت السيرفر
  const calculateTimeLeft = (endTime) => {
    if (!endTime) return 0;
    const diff = Math.floor((new Date(endTime) - new Date()) / 1000);
    return diff > 0 ? diff : 0;
  };

  const syncAllData = async () => {
    if (!isJoined || !roomCode) return;
    const { data: room } = await supabase
      .from("rooms")
      .select("*")
      .eq("room_code", roomCode)
      .single();
    if (room) {
      setRoomInfo(room);
      setTimeLeft(calculateTimeLeft(room.timer_end));
    }
    const { data: pList } = await supabase
      .from("players")
      .select("*")
      .eq("room_code", roomCode)
      .order("score", { ascending: false });
    if (pList) setPlayers(pList);
  };

  useEffect(() => {
    if (isJoined && roomCode) {
      const channel = supabase
        .channel(`room-${roomCode}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "rooms",
            filter: `room_code=eq.${roomCode}`,
          },
          (p) => {
            setRoomInfo(p.new);
            setTimeLeft(calculateTimeLeft(p.new.timer_end));
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "players",
            filter: `room_code=eq.${roomCode}`,
          },
          () => {
            syncAllData();
          }
        )
        .subscribe();

      const handleVisibility = () => {
        if (document.visibilityState === "visible") syncAllData();
      };
      document.addEventListener("visibilitychange", handleVisibility);
      syncAllData();

      return () => {
        supabase.removeChannel(channel);
        document.removeEventListener("visibilitychange", handleVisibility);
      };
    }
  }, [isJoined, roomCode]);

  // العداد (يتحدث كل ثانية بناءً على الفرق الزمني)
  useEffect(() => {
    let timer;
    if (roomInfo?.game_status === "answering" && timeLeft > 0) {
      timer = setInterval(
        () => setTimeLeft(calculateTimeLeft(roomInfo.timer_end)),
        1000
      );
    } else if (timeLeft <= 0 && roomInfo?.game_status === "answering") {
      if (roomInfo.current_turn_name === name) updateGameStatus("judging");
    }
    return () => clearInterval(timer);
  }, [timeLeft, roomInfo?.game_status]);

  const updateGameStatus = async (status, extra = {}) => {
    await supabase
      .from("rooms")
      .update({ game_status: status, ...extra })
      .eq("room_code", roomCode);
  };

  const submitQuestion = async () => {
    if (!questionInput) return alert("اكتب سؤالك!");
    // هنا بنحدد وقت النهاية (الآن + 15 ثانية) وبنبعته للسيرفر
    const timerEnd = new Date(Date.now() + 16000).toISOString();
    // تصفير إجابات اللاعبين قبل السؤال الجديد
    await supabase
      .from("players")
      .update({ last_answer: null, last_bet: null })
      .eq("room_code", roomCode);
    await updateGameStatus("answering", {
      current_question: questionInput,
      timer_end: timerEnd,
    });
  };

  const submitAnswer = async () => {
    if (!answerInput || !selectedBet) return alert("الرهان والإجابة!");
    // بنسجل الإجابة في جدول اللاعبين (مستحيل تضيع)
    await supabase
      .from("players")
      .update({ last_answer: answerInput, last_bet: selectedBet })
      .eq("name", name)
      .eq("room_code", roomCode);
    setUsedPoints([...usedPoints, selectedBet]);
    setSelectedBet(null);
    setAnswerInput("");
    alert("تم تسجيل إجابتك في السيرفر ✅");
  };

  const judgeAnswer = async (playerName, bet, isCorrect) => {
    if (isCorrect) {
      const p = players.find((x) => x.name === playerName);
      await supabase
        .from("players")
        .update({ score: (p.score || 0) + bet })
        .eq("name", playerName)
        .eq("room_code", roomCode);
    }
    // مسح إجابة هذا اللاعب بعد تقييمها عشان متظهرش تاني
    await supabase
      .from("players")
      .update({ last_answer: "DONE" })
      .eq("name", playerName)
      .eq("room_code", roomCode);
  };

  const nextTurn = async () => {
    const currentIndex = players.findIndex(
      (p) => p.name === roomInfo.current_turn_name
    );
    const nextIndex = (currentIndex + 1) % players.length;
    await updateGameStatus("asking", {
      current_turn_name: players[nextIndex].name,
      current_question: "",
      timer_end: null,
    });
  };

  // --- الواجهات ---
  if (isJoined && roomInfo?.game_status === "waiting") {
    return (
      <div className="App" style={{ padding: "20px", textAlign: "center" }}>
        <h2>روم: {roomCode} ⚽</h2>
        <div
          style={{
            background: "#f0f0f0",
            padding: "15px",
            borderRadius: "10px",
          }}
        >
          <h3>اللاعبون المتصلون:</h3>
          {players.map((p) => (
            <div key={p.id}>
              🏃‍♂️ {p.name} (Score: {p.score})
            </div>
          ))}
        </div>
        {isHost && players.length >= 2 && (
          <button
            onClick={() =>
              updateGameStatus("asking", { current_turn_name: name })
            }
            style={{
              marginTop: "20px",
              padding: "15px",
              background: "#28a745",
              color: "#fff",
              width: "100%",
              borderRadius: "10px",
              border: "none",
            }}
          >
            إبدأ التحدي 🔥
          </button>
        )}
      </div>
    );
  }

  if (isJoined && roomInfo) {
    const isMyTurn = roomInfo.current_turn_name === name;
    return (
      <div className="App" style={{ padding: "20px", textAlign: "center" }}>
        <div
          style={{
            background: "#333",
            color: "#fff",
            padding: "10px",
            borderRadius: "5px",
            marginBottom: "15px",
          }}
        >
          الدور على: <b>{roomInfo.current_turn_name}</b>
        </div>

        {roomInfo.game_status === "asking" &&
          (isMyTurn ? (
            <div>
              <h3>اكتب سؤالك:</h3>
              <textarea
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                style={{ width: "100%", height: "80px", padding: "10px" }}
              />
              <button
                onClick={submitQuestion}
                style={{
                  marginTop: "10px",
                  padding: "15px",
                  background: "#007bff",
                  color: "#fff",
                  width: "100%",
                  border: "none",
                }}
              >
                عرض السؤال للكل 🚀
              </button>
            </div>
          ) : (
            <h3>بانتظار السؤال... ⏳</h3>
          ))}

        {roomInfo.game_status === "answering" && (
          <div>
            <h2 style={{ color: timeLeft < 5 ? "red" : "orange" }}>
              ⏳ {timeLeft}s
            </h2>
            <div
              style={{
                background: "#fffbe6",
                padding: "20px",
                borderRadius: "10px",
                border: "1px solid #ffe58f",
              }}
            >
              <p style={{ fontSize: "20px" }}>{roomInfo.current_question}</p>
            </div>
            {!isMyTurn &&
              !players.find((p) => p.name === name)?.last_answer && (
                <div style={{ marginTop: "15px" }}>
                  <input
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    placeholder="إجابتك..."
                    style={{ width: "100%", padding: "10px" }}
                  />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(5, 1fr)",
                      gap: "5px",
                      marginTop: "10px",
                    }}
                  >
                    {[...Array(20)].map((_, i) => (
                      <button
                        key={i + 1}
                        disabled={usedPoints.includes(i + 1)}
                        onClick={() => setSelectedBet(i + 1)}
                        style={{
                          padding: "10px",
                          background:
                            selectedBet === i + 1 ? "#28a745" : "#fff",
                        }}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={submitAnswer}
                    style={{
                      marginTop: "15px",
                      padding: "15px",
                      background: "#28a745",
                      color: "#fff",
                      width: "100%",
                      border: "none",
                    }}
                  >
                    إرسال الإجابة ✅
                  </button>
                </div>
              )}
            {players.find((p) => p.name === name)?.last_answer && !isMyTurn && (
              <p>تم إرسال إجابتك، انتظر انتهاء الوقت!</p>
            )}
          </div>
        )}

        {roomInfo.game_status === "judging" && (
          <div>
            <h3>لوحة النتائج والتقييم:</h3>
            {isMyTurn ? (
              <div>
                {players
                  .filter((p) => p.last_answer && p.last_answer !== "DONE")
                  .map((p) => (
                    <div
                      key={p.id}
                      style={{
                        border: "1px solid #ccc",
                        padding: "10px",
                        margin: "10px 0",
                        borderRadius: "10px",
                      }}
                    >
                      <b>{p.name}</b>: {p.last_answer} (راهن بـ {p.last_bet})
                      <div style={{ marginTop: "10px" }}>
                        <button
                          onClick={() => judgeAnswer(p.name, p.last_bet, true)}
                          style={{
                            background: "green",
                            color: "#fff",
                            padding: "5px 15px",
                            border: "none",
                          }}
                        >
                          صح ✅
                        </button>
                        <button
                          onClick={() => judgeAnswer(p.name, p.last_bet, false)}
                          style={{
                            background: "red",
                            color: "#fff",
                            padding: "5px 15px",
                            border: "none",
                            marginLeft: "10px",
                          }}
                        >
                          خطأ ❌
                        </button>
                      </div>
                    </div>
                  ))}
                <button
                  onClick={nextTurn}
                  style={{
                    marginTop: "20px",
                    padding: "15px",
                    background: "#000",
                    color: "#fff",
                    width: "100%",
                    border: "none",
                  }}
                >
                  إنهاء الدور ➡️
                </button>
              </div>
            ) : (
              <p>صاحب السؤال يقوم بتقييم الإجابات الآن...</p>
            )}
            <div
              style={{
                marginTop: "20px",
                borderTop: "1px solid #ddd",
                paddingTop: "10px",
              }}
            >
              <h4>ترتيب النقاط:</h4>
              {players.map((p) => (
                <div key={p.id}>
                  {p.name}: {p.score} نقطة
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="App" style={{ padding: "30px", textAlign: "center" }}>
      <h1>⚽ ملعب الأبطال ⚽</h1>
      <input
        placeholder="اسمك..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          padding: "15px",
          width: "80%",
          marginBottom: "20px",
          borderRadius: "10px",
          border: "1px solid #ccc",
        }}
      />
      <button
        onClick={() => handleJoin(generateRoomCode(), true)}
        style={{
          padding: "15px",
          background: "#28a745",
          color: "#fff",
          width: "85%",
          borderRadius: "10px",
          border: "none",
          fontSize: "16px",
        }}
      >
        إنشاء غرفة
      </button>
      <div style={{ marginTop: "20px" }}>
        <input
          placeholder="كود الروم"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          style={{
            padding: "10px",
            width: "40%",
            borderRadius: "5px",
            border: "1px solid #ccc",
          }}
        />
        <button
          onClick={() => handleJoin()}
          style={{
            padding: "10px 15px",
            background: "#007bff",
            color: "#fff",
            border: "none",
            borderRadius: "5px",
            marginLeft: "5px",
          }}
        >
          انضمام
        </button>
      </div>
    </div>
  );

  async function handleJoin(code, host = false) {
    if (!name.trim()) return alert("اكتب اسمك!");
    const cleanCode = code?.toUpperCase() || roomCode.toUpperCase();
    setIsHost(host);
    if (host)
      await supabase
        .from("rooms")
        .insert([
          { room_code: cleanCode, host_name: name, game_status: "waiting" },
        ]);
    const { error } = await supabase
      .from("players")
      .upsert([{ name, room_code: cleanCode, score: 0 }], {
        onConflict: "name, room_code",
      });
    if (!error) {
      setRoomCode(cleanCode);
      setIsJoined(true);
    } else alert("الاسم محجوز!");
  }
}
