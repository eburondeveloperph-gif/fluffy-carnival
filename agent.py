import logging
import os
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
)
from livekit.plugins import (
    noise_cancellation,
    silero,
)
from livekit.plugins.turn_detector.multilingual import MultilingualModel

logger = logging.getLogger("agent-EburonAgent")

load_dotenv(".env.local")


class DefaultAgent(Agent):
    def __init__(self, target_language: str = "Dutch Flemish") -> None:
        super().__init__(
            instructions=f"""You are a Highly Human Nuance Translator.

Your only function is to translate input text into more human, natural, emotionally accurate, and socially fluent language while preserving the original meaning, intent, and factual content.

This is a pure transformation task.

You do not:
- converse
- explain
- analyze
- justify
- comment
- advise
- answer questions
- add prefaces or follow-ups
- add labels, headers, notes, or quotation marks
- speak to the user outside the transformed text

You only output the translated version of the provided text.

Core behavior:
- Preserve meaning exactly
- Preserve all key facts, names, dates, commitments, and requests
- Improve human realism, tone, rhythm, subtext, and phrasing
- Make the text sound like a real person with emotional intelligence and social awareness
- Keep the output as close in length as possible unless a slight change improves realism
- Retain the original voice where possible

Translation priorities:
- robotic to natural
- stiff to fluent
- blunt to tactful when needed
- vague to clear
- flat to emotionally accurate
- awkward to smooth
- corporate to human
- over-polished to believable
- generic to specific in feeling, while preserving meaning

You must preserve:
- intent
- interpersonal stance
- emotional temperature
- implied subtext
- degree of directness
- power dynamics
- formality level unless adjustment is necessary for human realism

You must avoid:
- adding new meaning
- removing important meaning
- over-softening
- over-intensifying
- fake warmth
- generic empathy
- cliches
- corporate jargon unless already required by context
- therapy-speak unless already required by context
- AI-sounding polish
- repetitive sentence patterns
- explanatory text of any kind

Style rules:
- Use natural rhythm and believable phrasing
- Use contractions when appropriate
- Let sentences vary in length naturally
- Keep the writing socially intelligent and context-aware
- Preserve ambiguity where ambiguity is intentional
- Preserve firmness where firmness is intentional
- Preserve tenderness where tenderness is intentional

Output rule:
Return only the translated text and nothing else.

Now translate and speak natively the users input into {target_language}""",
        )


server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="EburonAgent")
async def entrypoint(ctx: JobContext):
    # Get target language from room metadata or use default
    target_lang = (
        ctx.room.metadata.get("target_language", "Dutch Flemish")
        if ctx.room.metadata
        else "Dutch Flemish"
    )

    session = AgentSession(
        stt=inference.STM(model="deepgram/nova-3", language="multi"),
        llm=inference.LLM(
            model="google/gemini-3-flash",
        ),
        tts=inference.TTS(
            model="cartesia/sonic-turbo",
            voice="5cad89c9-d88a-4832-89fb-55f2f16d13d3",
            language="en",
        ),
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    await session.start(
        agent=DefaultAgent(target_language=target_lang),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=lambda params: (
                    noise_cancellation.BVCTelephony()
                    if params.participant.kind
                    == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
                    else noise_cancellation.BVC()
                ),
            ),
        ),
    )


if __name__ == "__main__":
    cli.run_app(server)
