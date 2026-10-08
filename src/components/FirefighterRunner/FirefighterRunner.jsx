import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import firefighterSheet from "./firefighter.png";
import chiefSheet from "./chief.png";
import fireballSheet from "./fireball.png";
import heliSheet from "./heli.png";
// The boss's own effect. An mp3, and deliberately NOT part of the member sound profile below: that
// profile is a filename PREFIX for the .wav effects (jump / die / point), and it resolves .wav only.
// The music that will sit beside this file will follow the same "fixed, not personalised" rule.
import fireballSound from "./fireball.mp3";
import menuMusic from "./menu_music.mp3";
import normalMusic from "./normal_music.mp3";
import normalMusic2 from "./normal_music2.mp3";
import bossMusic from "./boss_music.mp3";
import { soundsForProfile } from "../../utils/runnerSounds";
import { MUSIC_VOLUME, musicTrackFor } from "../../utils/runnerMusic";
// How much of the fixed 800x280 world fits in the box the cabinet has been given - see the note on the helper, and on
// the stage below.
import { gameFit } from "../../utils/runnerFit";
import {
  BOSS_INTERVAL_SECONDS,
  BOSS_DURATION_SECONDS,
  CHIEF_DISPLAY_SIZE,
  FIREBALL_SPEED,
  chiefFrame,
  createLevel,
  startBoss,
  stepLevel,
} from "../../utils/runnerLevel";

// Every .wav beside this component, as a path -> URL map.
//
// A glob rather than three import statements, so a profile prefix can be resolved at runtime: a
// `bird` profile finds `bird-jump.wav`, and dropping a new set into the folder needs no code
// change. It also means the custom files are actually bundled - they were being ignored before,
// because nothing imported them.
const SOUND_FILES = import.meta.glob("./*.wav", { eager: true, query: "?url", import: "default" });
import { fetchRunnerLeaderboard, saveRunnerScore } from "../../services/api";
import { unnamedLabel } from "../../utils/displayLabel";
import "./FirefighterRunner.css";

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 280;

const SPRITE_DISPLAY_SIZE = 64;
const GROUND_HEIGHT = 42;

const PLAYER_SPRITE_SIZE = 64;
const PLAYER_NORMAL_HITBOX = {
  x: 9,
  y: 6,
  width: 46,
  height: 52,
};

const PLAYER_DUCK_HITBOX = {
  x: 6,
  y: 28,
  width: 52,
  height: 30,
};

const GRAVITY = 1850;
const JUMP_VELOCITY = -700;
const DUCK_FALL_MULTIPLIER = 1.55;

const SCORE_MILESTONE = 300;

const SPRITES = {
  idle: [[0, 0], [1, 0]],
  fall: [[2, 0], [3, 0]],
  run: [[0, 1], [1, 1], [2, 1], [3, 1]],
  jump: [[0, 2], [1, 2], [2, 2], [3, 2]],
  duck: [[0, 3], [1, 3], [2, 3], [3, 3]],
  dead: [[0, 4], [1, 4], [2, 4], [3, 4]],
};

// --- the obstacles ------------------------------------------------------------------------------
//
// The hydrant and the parked firetruck are inline SVGs, drawn to fill the box they spawn with. The
// helicopter is a sprite sheet like the boss sheets - one row of four 128px cells - and its rotor is
// always turning, because that is what makes it read as flying.
//
// The helicopter's art does not fill its cell. Measured from the sheet, the union of the four frames
// sits in this rectangle, with the rotor sweeping the top of it. The sprite is drawn at 80% of a cell,
// so it comes out a fifth smaller than the sheet drew it, and the hitbox scales with the sprite: the
// helicopter collides on the helicopter, never on the transparent margin around it - the rule the
// fireball already follows with its flame.
const HELI_CELL_SIZE = 128;
const HELI_SCALE = 0.8;
const HELI_DISPLAY_SIZE = HELI_CELL_SIZE * HELI_SCALE; // 102.4
const HELI_BODY = { x: 8, y: 25, width: 114, height: 75 }; // in sheet pixels, so it scales with it
const HELI_FRAME_SECONDS = 0.08; // about three turns of the rotor a second
// Where a helicopter hovers, as the height of its BODY above the ground. The lowest is the one that
// has to be ducked - it catches a standing player and passes over a ducking one - and the other two
// fly overhead, which is what the truck's three heights did before it.
const HELI_BODY_BOTTOMS = [44, 78, 110];

// --- the boss level's rendering ----------------------------------------------------------------
//
// The chief's arrival, hover, firing and departure are decisions, and they live in
// utils/runnerLevel so they can be tested without a browser (the same split utils/soundRules uses).
// What stays here is how the two boss sheets are drawn.
//
// The chief, the fireball and the helicopter are each one row of four 128px cells (a 512x128 png), so
// one frame count does for all three. Each is drawn at its own display size: the cell scales with it.
const STRIP_FRAMES = 4;
// The flame art is small and centred inside its 128px cell, so the sprite box is mostly transparent
// margin and must be drawn much larger than the fireball looks. These are the flame's real bounds
// within the cell (measured from the sheet); it is the FLAME - not the box - that collides and that
// the level positions, so the spawn adds this offset and the hitbox is exactly this rectangle.
const FIREBALL_DISPLAY_SIZE = 128;
const FIREBALL_FLAME = { x: 46, y: 52, width: 40, height: 24 };
// The fireball is always animating; the chief holds its last frame between shots.
const FIREBALL_FRAME_SECONDS = 0.085;

// The music, by the track names utils/runnerMusic deals in. All four loop.
const MUSIC_SOURCES = {
  menu: menuMusic,
  normal: normalMusic,
  normal2: normalMusic2,
  boss: bossMusic,
};

// Remembers the music mute for the next visit, the way the high score is remembered.
const MUSIC_MUTED_KEY = "firefighter-runner-music-muted";

// And the same for the game's own sound effects (jump / die / point / fireball), which switch
// separately from the music.
const SFX_MUTED_KEY = "firefighter-runner-sfx-muted";

function intersects(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function HydrantSprite() {
  return (
    <svg width="42" height="64" viewBox="0 0 42 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="ffr__obstacle-sprite">
      <path id="Path" fill="#a93439" stroke="none" d="M 25.016703 1.41394 C 25.016703 0.652916 24.394396 0.027027 23.63773 0.027027 L 18.319841 0.027027 C 17.563173 0.027027 16.940868 0.652916 16.940868 1.41394 L 16.940868 4.465149 C 16.940868 5.226173 17.563173 5.852062 18.319841 5.852062 L 23.63773 5.852062 C 24.394396 5.852062 25.016703 5.226173 25.016703 4.465149 L 25.016703 1.41394 Z" />
      <path id="path1" fill="#ff5959" stroke="none" d="M 5.025121 36.008537 C 5.025121 35.247513 4.402814 34.62162 3.646148 34.62162 L 2.047953 34.62162 C 1.291285 34.62162 0.668979 35.247513 0.668979 36.008537 L 0.668979 39.970127 C 0.668979 40.731155 1.291285 41.35704 2.047953 41.35704 L 3.653221 41.35704 C 4.409887 41.35704 5.032194 40.731155 5.032194 39.970127 L 5.025121 36.008537 Z" />
      <path id="path2" fill="#a93439" stroke="none" d="M 8.313443 33.120911 C 8.313443 32.210526 7.570919 31.463726 6.665745 31.463726 L 5.187769 31.463726 C 4.282597 31.463726 3.540073 32.210526 3.540073 33.120911 L 3.540073 42.85775 C 3.540073 43.768135 4.282597 44.514931 5.187769 44.514931 L 6.665745 44.514931 C 7.570919 44.514931 8.313443 43.768135 8.313443 42.85775 L 8.313443 33.120911 Z" />
      <path id="path3" fill="#ff5959" stroke="none" d="M 36.925377 36.008537 C 36.925377 35.247513 37.547684 34.62162 38.304352 34.62162 L 39.909618 34.62162 C 40.666286 34.62162 41.288589 35.247513 41.288589 36.008537 L 41.288589 39.970127 C 41.288589 40.731155 40.666286 41.35704 39.909618 41.35704 L 38.304352 41.35704 C 37.547684 41.35704 36.925377 40.731155 36.925377 39.970127 L 36.925377 36.008537 Z" />
      <path id="path4" fill="#a93439" stroke="none" d="M 33.644127 33.120911 C 33.644127 32.210526 34.38665 31.463726 35.291824 31.463726 L 36.769802 31.463726 C 37.674973 31.463726 38.417496 32.210526 38.417496 33.120911 L 38.417496 42.85775 C 38.417496 43.768135 37.674973 44.514931 36.769802 44.514931 L 35.284752 44.514931 C 34.379581 44.514931 33.637054 43.768135 33.637054 42.85775 L 33.637054 33.120911 Z" />
      <path id="path5" fill="#ff5959" stroke="none" d="M 38.629646 17.523472 C 38.056843 17.523472 37.597183 17.054054 37.597183 16.485065 L 37.597183 14.386913 C 37.597183 13.81081 38.063915 13.348507 38.629646 13.348507 C 39.20245 13.348507 39.662109 13.817924 39.662109 14.386913 L 39.662109 16.485065 C 39.669182 17.054054 39.20245 17.523472 38.629646 17.523472 Z M 3.327923 17.523472 C 2.755119 17.523472 2.295461 17.054054 2.295461 16.485065 L 2.295461 14.386913 C 2.295461 13.81081 2.76219 13.348507 3.327923 13.348507 C 3.893656 13.348507 4.360387 13.817924 4.360387 14.386913 L 4.360387 16.485065 C 4.360387 17.054054 3.893656 17.523472 3.327923 17.523472 Z M 34.796806 16.840683 C 34.796806 9.166431 28.609102 2.9431 20.978785 2.9431 C 13.348464 2.9431 7.160761 9.166431 7.160761 16.840683 L 34.796806 16.840683 Z M 6.55967 21.662872 L 35.3979 21.662872 L 35.3979 57.736843 L 6.55967 57.736843 Z" />
      <path id="path6" fill="#000000" stroke="none" d="M 6.55967 51.001419 L 35.3979 51.001419 L 35.3979 54.337128 L 6.55967 54.337128 Z M 30.270943 25.795162 C 29.698141 25.795162 29.238483 25.325748 29.238483 24.756756 L 29.238483 22.658607 C 29.238483 22.082504 29.70521 21.620197 30.270943 21.620197 C 30.84375 21.620197 31.303408 22.089615 31.303408 22.658607 L 31.303408 24.756756 C 31.303408 25.325748 30.84375 25.795162 30.270943 25.795162 Z M 20.978785 25.795162 C 20.405981 25.795162 19.946323 25.325748 19.946323 24.756756 L 19.946323 22.658607 C 19.946323 22.082504 20.413052 21.620197 20.978785 21.620197 C 21.55159 21.620197 22.011248 22.089615 22.011248 22.658607 L 22.011248 24.756756 C 22.011248 25.325748 21.55159 25.795162 20.978785 25.795162 Z M 10.781452 25.795162 C 10.208648 25.795162 9.74899 25.325748 9.74899 24.756756 L 9.74899 22.658607 C 9.74899 22.082504 10.215719 21.620197 10.781452 21.620197 C 11.347185 21.620197 11.813914 22.089615 11.813914 22.658607 L 11.813914 24.756756 C 11.813914 25.325748 11.354257 25.795162 10.781452 25.795162 Z" />
      <path id="path7" fill="#000000" stroke="none" d="M 6.55967 21.662872 L 35.3979 21.662872 L 35.3979 26.556187 L 6.55967 26.556187 Z" />
      <path id="path8" fill="#a93439" stroke="none" d="M 41.917969 17.97155 C 41.917969 16.605976 40.807716 15.48933 39.449959 15.48933 L 2.500539 15.48933 C 1.14278 15.48933 0.03253 16.605976 0.03253 17.97155 L 0.03253 20.503555 C 0.03253 21.869133 1.14278 22.985775 2.500539 22.985775 L 39.449959 22.985775 C 40.807716 22.985775 41.917969 21.869133 41.917969 20.503555 L 41.917969 17.97155 Z M 40.086411 60.119488 L 40.086411 63.092461 C 40.086411 63.547653 39.718681 63.9175 39.266098 63.9175 L 2.691473 63.9175 C 2.238887 63.9175 1.871161 63.547653 1.871161 63.092461 L 1.871161 60.119488 C 1.871161 58.440968 3.228921 57.075394 4.89783 57.075394 L 37.066811 57.075394 C 38.735722 57.075394 40.086411 58.440968 40.086411 60.119488 Z" />
      <path id="path9" fill="#a93439" stroke="none" d="M 14.494073 37.992889 C 14.494073 41.594913 17.397377 44.514931 20.978785 44.514931 C 24.56019 44.514931 27.463499 41.594913 27.463499 37.992889 C 27.463499 34.390862 24.56019 31.47084 20.978785 31.47084 C 17.397377 31.47084 14.494073 34.390862 14.494073 37.992889 Z" />
      <path id="path10" fill="#ff5959" stroke="none" d="M 17.63389 37.992889 C 17.63389 39.850861 19.131453 41.35704 20.978785 41.35704 C 22.826118 41.35704 24.323681 39.850861 24.323681 37.992889 C 24.323681 36.134918 22.826118 34.628731 20.978785 34.628731 C 19.131453 34.628731 17.63389 36.134918 17.63389 37.992889 Z" />
      <path id="path11" fill="#a93439" stroke="none" d="M 37.045597 51.47084 C 37.045597 52.004269 36.614223 52.445232 36.076778 52.445232 L 5.880794 52.445232 C 5.350419 52.445232 4.911975 52.011379 4.911975 51.47084 L 4.911975 49.977242 C 4.911975 49.443813 5.343346 49.002846 5.880794 49.002846 L 36.076778 49.002846 C 36.607151 49.002846 37.045597 49.436699 37.045597 49.977242 L 37.045597 51.47084 Z" />
      <path id="path12" fill="#000000" stroke="none" d="M 20.978785 13.064011 C 20.405981 13.064011 19.946323 12.594593 19.946323 12.025604 L 19.946323 6.520626 C 19.946323 5.944523 20.413052 5.48222 20.978785 5.48222 C 21.55159 5.48222 22.011248 5.951637 22.011248 6.520626 L 22.011248 12.025604 C 22.011248 12.601707 21.55159 13.064011 20.978785 13.064011 Z M 13.659617 13.064011 C 13.086813 13.064011 12.627155 12.594593 12.627155 12.025604 L 12.627155 9.251778 C 12.627155 8.675674 13.093884 8.213371 13.659617 8.213371 C 14.232422 8.213371 14.69208 8.682789 14.69208 9.251778 L 14.69208 12.025604 C 14.699151 12.601707 14.232422 13.064011 13.659617 13.064011 Z M 28.297953 13.064011 C 27.725145 13.064011 27.265488 12.594593 27.265488 12.025604 L 27.265488 9.251778 C 27.265488 8.675674 27.73222 8.213371 28.297953 8.213371 C 28.870756 8.213371 29.330416 8.682789 29.330416 9.251778 L 29.330416 12.025604 C 29.330416 12.601707 28.863686 13.064011 28.297953 13.064011 Z" />
    </svg>
  );
}

function FireTruckSprite() {
  return (
    <svg width="64" height="40" viewBox="0 0 64 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="ffr__obstacle-sprite">
      <path id="Path" fill="#ff8189" stroke="none" d="M 55.121429 5.823345 C 55.021427 5.459476 54.628571 5.159817 54.25 5.159817 L 50.192856 5.159817 C 49.814285 5.159817 49.421429 5.459476 49.32143 5.823345 L 48.414288 9.105309 C 48.314285 9.469177 48.542858 9.768835 48.921429 9.768835 L 55.528572 9.768835 C 55.907143 9.768835 56.135715 9.469177 56.035713 9.105309 L 55.121429 5.823345 Z" />
      <path id="path1" fill="#a4a9ad" stroke="none" d="M 9.192857 4.410675 L 12.664286 4.410675 L 12.664286 7.871006 L 9.192857 7.871006 Z" />
      <path id="path2" fill="#000000" stroke="none" d="M 9.192857 4.410675 L 12.664286 4.410675 L 12.664286 5.923229 L 9.192857 5.923229 Z" />
      <path id="path3" fill="#a4a9ad" stroke="none" d="M 17.585716 4.410675 L 21.057142 4.410675 L 21.057142 7.871006 L 17.585716 7.871006 Z" />
      <path id="path4" fill="#000000" stroke="none" d="M 17.585716 4.410675 L 21.057142 4.410675 L 21.057142 5.923229 L 17.585716 5.923229 Z" />
      <path id="path5" fill="#a4a9ad" stroke="none" d="M 25.971428 4.410675 L 29.442858 4.410675 L 29.442858 7.871006 L 25.971428 7.871006 Z" />
      <path id="path6" fill="#000000" stroke="none" d="M 25.971428 4.410675 L 29.442858 4.410675 L 29.442858 5.923229 L 25.971428 5.923229 Z" />
      <path id="path7" fill="#ff5959" stroke="none" d="M 2.228571 33.063637 L 2.228571 11.309931 C 2.228571 9.419235 3.778571 7.878139 5.664286 7.878139 L 58.314285 7.878139 C 60.207142 7.878139 61.75 9.426371 61.75 11.309931 L 61.75 33.056507 L 2.228571 33.056507 Z" />
      <path id="path8" fill="#d1d3d3" stroke="none" d="M 2.228571 21.312788 L 61.757141 21.312788 L 61.757141 24.009705 L 2.228571 24.009705 Z" />
      <path id="path9" fill="#a4a9ad" stroke="none" d="M 63.921429 34.098171 C 63.921429 34.804508 63.342857 35.375286 62.642857 35.375286 L 59.764286 35.375286 C 59.057144 35.375286 58.485714 34.797375 58.485714 34.098171 L 58.485714 32.021976 C 58.485714 31.315636 59.064285 30.744862 59.764286 30.744862 L 62.642857 30.744862 C 63.349998 30.744862 63.921429 31.322773 63.921429 32.021976 L 63.921429 34.098171 Z M 4.95 34.098171 C 4.95 34.804508 4.371428 35.375286 3.671429 35.375286 L 1.335714 35.375286 C 0.628572 35.375286 0.057143 34.797375 0.057143 34.098171 L 0.057143 32.021976 C 0.057143 31.315636 0.635714 30.744862 1.335714 30.744862 L 3.664286 30.744862 C 4.371428 30.744862 4.942857 31.322773 4.942857 32.021976 L 4.95 34.098171 Z" />
      <path id="path10" fill="#000000" stroke="none" d="M 24.764286 33.063637 C 24.764286 28.447491 21.014286 24.701771 16.392857 24.701771 C 11.771428 24.701771 8.021428 28.447491 8.021428 33.063637 L 24.764286 33.063637 Z" />
      <path id="path11" fill="#333e48" stroke="none" d="M 9.457143 33.063637 C 9.457143 36.885818 12.55917 39.984303 16.385714 39.984303 C 20.212257 39.984303 23.314285 36.885818 23.314285 33.063637 C 23.314285 29.241467 20.212257 26.142977 16.385714 26.142977 C 12.55917 26.142977 9.457143 29.241467 9.457143 33.063637 Z" />
      <path id="path12" fill="#a4a9ad" stroke="none" d="M 12.871428 33.063637 C 12.871428 35.002312 14.444828 36.573914 16.385714 36.573914 C 18.326601 36.573914 19.9 35.002312 19.9 33.063637 C 19.9 31.124973 18.326601 29.553371 16.385714 29.553371 C 14.444828 29.553371 12.871428 31.124973 12.871428 33.063637 Z" />
      <path id="path13" fill="#000000" stroke="none" d="M 55.964287 33.063637 C 55.964287 28.447491 52.214287 24.701771 47.592857 24.701771 C 42.971428 24.701771 39.221424 28.447491 39.221424 33.063637 L 55.964287 33.063637 Z" />
      <path id="path14" fill="#333e48" stroke="none" d="M 40.664288 33.063637 C 40.664288 36.885818 43.766312 39.984303 47.592857 39.984303 C 51.419403 39.984303 54.521427 36.885818 54.521427 33.063637 C 54.521427 29.241467 51.419403 26.142977 47.592857 26.142977 C 43.766312 26.142977 40.664288 29.241467 40.664288 33.063637 Z" />
      <path id="path15" fill="#a4a9ad" stroke="none" d="M 44.078571 33.063637 C 44.078571 35.002312 45.65197 36.573914 47.592857 36.573914 C 49.533745 36.573914 51.107143 35.002312 51.107143 33.063637 C 51.107143 31.124973 49.533745 29.553371 47.592857 29.553371 C 45.65197 29.553371 44.078571 31.124973 44.078571 33.063637 Z" />
      <path id="path16" fill="#d1d3d3" stroke="none" d="M 47.592857 1.392693 C 47.592857 0.636417 46.971428 0.015697 46.214287 0.015697 L 6.821429 0.015697 C 6.064285 0.015697 5.442857 0.636417 5.442857 1.392693 L 5.442857 3.04081 C 5.442857 3.797089 6.064285 4.417809 6.821429 4.417809 L 46.221428 4.417809 C 46.978573 4.417809 47.599998 3.797089 47.599998 3.04081 L 47.592857 1.392693 Z" />
      <path id="path17" fill="#333e48" stroke="none" d="M 48.278572 16.568209 C 48.278572 17.174658 48.771427 17.666952 49.378571 17.666952 L 57.385715 17.666952 C 57.992859 17.666952 58.485714 17.174658 58.485714 16.568209 L 58.485714 11.802225 C 58.485714 11.195776 57.992859 10.703482 57.385715 10.703482 L 49.378571 10.703482 C 48.771427 10.703482 48.278572 11.195776 48.278572 11.802225 L 48.278572 16.568209 Z" />
      <path id="path18" fill="#000000" stroke="none" d="M 57.385715 10.710617 L 49.378571 10.710617 C 48.771427 10.710617 48.278572 11.202911 48.278572 11.809361 L 48.278572 13.229166 C 48.278572 12.622717 48.771427 12.130423 49.378571 12.130423 L 57.385715 12.130423 C 57.992859 12.130423 58.485714 12.622717 58.485714 13.229166 L 58.485714 11.809361 C 58.492859 11.202911 57.992859 10.710617 57.385715 10.710617 Z" />
      <path id="path19" fill="#333e48" stroke="none" d="M 38.257141 16.568209 C 38.257141 17.174658 38.75 17.666952 39.357143 17.666952 L 44.064285 17.666952 C 44.671429 17.666952 45.164288 17.174658 45.164288 16.568209 L 45.164288 11.802225 C 45.164288 11.195776 44.671429 10.703482 44.064285 10.703482 L 39.357143 10.703482 C 38.75 10.703482 38.257141 11.195776 38.257141 11.802225 L 38.257141 16.568209 Z" />
      <path id="path20" fill="#000000" stroke="none" d="M 44.064285 10.710617 L 39.357143 10.710617 C 38.75 10.710617 38.257141 11.202911 38.257141 11.809361 L 38.257141 13.229166 C 38.257141 12.622717 38.75 12.130423 39.357143 12.130423 L 44.064285 12.130423 C 44.671429 12.130423 45.164288 12.622717 45.164288 13.229166 L 45.164288 11.809361 C 45.164288 11.202911 44.671429 10.710617 44.064285 10.710617 Z" />
      <path id="path21" fill="#a4a9ad" stroke="none" d="M 26.828571 19.664669 L 37.157143 19.664669 L 37.157143 33.063637 L 26.828571 33.063637 Z" />
      <path id="path22" fill="#d1d3d3" stroke="none" d="M 28.978571 23.189213 C 28.978571 23.721163 29.410295 24.152397 29.942858 24.152397 C 30.475418 24.152397 30.907143 23.721163 30.907143 23.189213 C 30.907143 22.657259 30.475418 22.226027 29.942858 22.226027 C 29.410295 22.226027 28.978571 22.657259 28.978571 23.189213 Z" />
      <path id="path23" fill="#d1d3d3" stroke="none" d="M 33.07143 23.189213 C 33.07143 23.721163 33.503155 24.152397 34.035713 24.152397 C 34.568275 24.152397 35 23.721163 35 23.189213 C 35 22.657259 34.568275 22.226027 34.035713 22.226027 C 33.503155 22.226027 33.07143 22.657259 33.07143 23.189213 Z" />
      <path id="path24" fill="#d1d3d3" stroke="none" d="M 34.035713 27.598459 L 29.942858 27.598459 C 29.371429 27.598459 28.914286 27.134705 28.914286 26.57106 C 28.914286 26.00742 29.378571 25.543663 29.942858 25.543663 L 34.035713 25.543663 C 34.607143 25.543663 35.064289 26.00742 35.064289 26.57106 C 35.064289 27.134705 34.607143 27.598459 34.035713 27.598459 Z M 34.035713 30.744862 L 29.942858 30.744862 C 29.371429 30.744862 28.914286 30.281105 28.914286 29.717464 C 28.914286 29.153824 29.378571 28.690067 29.942858 28.690067 L 34.035713 28.690067 C 34.607143 28.690067 35.064289 29.153824 35.064289 29.717464 C 35.064289 30.281105 34.607143 30.744862 34.035713 30.744862 Z" />
      <path id="path25" fill="#ffb819" stroke="none" d="M 61.757141 30.744862 L 58.814285 30.744862 C 58.435715 30.744862 58.128571 30.438072 58.128571 30.059933 L 58.128571 28.319061 C 58.128571 27.940926 58.435715 27.634132 58.814285 27.634132 L 61.757141 27.634132 L 61.757141 30.744862 Z M 2.228571 30.744862 L 5.171428 30.744862 C 5.55 30.744862 5.857143 30.438072 5.857143 30.059933 L 5.857143 28.319061 C 5.857143 27.940926 5.55 27.634132 5.171428 27.634132 L 2.228571 27.634132 L 2.228571 30.744862 Z M 8.671429 13.15782 L 31.314285 13.15782 L 31.314285 15.219749 L 8.671429 15.219749 Z" />
      <path id="path26" fill="#d1d3d3" stroke="none" d="M 33.17857 12.401541 C 33.17857 12.023401 32.871429 11.71661 32.492859 11.71661 L 30.15 11.71661 C 29.771429 11.71661 29.464285 12.023401 29.464285 12.401541 L 29.464285 15.976027 C 29.464285 16.354166 29.771429 16.660959 30.15 16.660959 L 32.492859 16.660959 C 32.871429 16.660959 33.17857 16.354166 33.17857 15.976027 L 33.17857 12.401541 Z M 10.528571 12.401541 C 10.528571 12.023401 10.221429 11.71661 9.842857 11.71661 L 7.5 11.71661 C 7.121428 11.71661 6.814285 12.023401 6.814285 12.401541 L 6.814285 15.976027 C 6.814285 16.354166 7.121428 16.660959 7.5 16.660959 L 9.842857 16.660959 C 10.221429 16.660959 10.528571 16.354166 10.528571 15.976027 L 10.528571 12.401541 Z" />
    </svg>
  );
}

function SpriteFrame({ animation, frame }) {
  const frames = SPRITES[animation] || SPRITES.idle;
  const [column, row] = frames[frame % frames.length];

  return (
    <div
      className="ffr__sprite"
      style={{
        backgroundImage: `url(${firefighterSheet})`,
        backgroundPosition: `
          -${column * SPRITE_DISPLAY_SIZE}px
          -${row * SPRITE_DISPLAY_SIZE}px
        `,
        backgroundSize: "256px 320px",
      }}
      aria-hidden="true"
    />
  );
}

// One row of equal-width cells. The chief, the fireball and the helicopter are all a 4-cell strip, so
// unlike SpriteFrame this needs no frame table - the cell is just `frame` along the row.
function StripSprite({ sheet, frame, frames = STRIP_FRAMES, displaySize }) {
  return (
    <div
      className="ffr__sprite"
      style={{
        width: `${displaySize}px`,
        height: `${displaySize}px`,
        backgroundImage: `url(${sheet})`,
        backgroundPosition: `-${frame * displaySize}px 0`,
        backgroundSize: `${displaySize * frames}px ${displaySize}px`,
      }}
      aria-hidden="true"
    />
  );
}

function getAnimation(player) {
  if (player.dead) return "dead";
  if (player.ducking && player.grounded) return "duck";
  if (!player.grounded) {
    return player.velocityY >= 0 ? "fall" : "jump";
  }
  return "run";
}

// A boolean the member can toggle that is remembered on the device - the two audio switches. A ref
// mirrors it so the game loop, which runs outside React, can read the value it needs without the flag
// becoming a dependency of the effect that drives the loop.
function useStoredFlag(key) {
  const [on, setOn] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const ref = useRef(on);

  useEffect(() => {
    ref.current = on;
    try {
      window.localStorage.setItem(key, on ? "1" : "0");
    } catch {
      /* storage unavailable - the choice still holds for this session */
    }
  }, [key, on]);

  return [on, setOn, ref];
}

export default function FirefighterRunner({
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  initialSpeed = 350,
  maxSpeed = 900,
  onGameOver,
  // The leaderboard is optional: without a token (or against a backend that predates it)
  // the game plays exactly as before, just with no board underneath it.
  token,
  currentUser,
  // A prefix for this member's sound files, from their user_settings row. Empty means the
  // defaults, which is what a station that never sets one hears.
  soundProfile = "",
  // Shows the admin-only debug control that jumps straight to the boss scene. False for everyone
  // else, so an ordinary member never sees it.
  isAdmin = false,
  // The lines the chief may come out with between fireball blasts, from the station's system settings. A short list of
  // short strings, and it MUST BE A STABLE ARRAY: it goes into the level's bounds, and the game loop's effect depends on
  // those bounds - an array rebuilt on every render would restart the loop on every render, which is a stutter nobody
  // would ever think to look for here. App memoises it against the settings it comes from. An empty list means the chief
  // says nothing, which is what a station that has blanked all five is asking for.
  bossSayings = [],
}) {
  const animationRef = useRef(null);
  const lastTimeRef = useRef(0);
  const spawnTimerRef = useRef(0.9);
  const distanceRef = useRef(0);
  const scoreRef = useRef(0);
  const highScoreRef = useRef(0);
  const playerRef = useRef(null);
  const obstaclesRef = useRef([]);
  const particlesRef = useRef([]);
  const animationStateRef = useRef({ name: "idle", frame: 0, timer: 0 });
  const jumpAudioRef = useRef(null);
  const dieAudioRef = useRef(null);
  const pointAudioRef = useRef(null);
  const diePlayedRef = useRef(false);
  // True from the fatal collision until the game-over screen: the loop keeps running for the death
  // animation, which is the one part of a run that outlives the run.
  const dyingRef = useRef(false);
  const fireballAudioRef = useRef(null);
  const fireballsRef = useRef([]);
  // The level clock and the chief - the whole boss cycle, owned by utils/runnerLevel. The loop hands
  // it the elapsed time and applies the events it hands back.
  const levelRef = useRef(createLevel());

  // Music: one element, switched between tracks by utils/runnerMusic's decision.
  const musicAudioRef = useRef(null);
  const musicTrackRef = useRef(null);
  // The two audio switches - the music, and the game's own effects. Each is remembered on the device,
  // and each has a ref the loop can read without the flag becoming a dependency.
  const [musicMuted, setMusicMuted, musicMutedRef] = useStoredFlag(MUSIC_MUTED_KEY);
  const [sfxMuted, setSfxMuted, sfxMutedRef] = useStoredFlag(SFX_MUTED_KEY);

  useEffect(() => {
    // Resolved once per profile: a profile of `bird` picks up bird-*.wav, while an empty profile -
    // or an unknown prefix - picks up the defaults beside it.
    const sounds = soundsForProfile(SOUND_FILES, soundProfile);

    jumpAudioRef.current = sounds.jump ? new Audio(sounds.jump) : null;
    dieAudioRef.current = sounds.die ? new Audio(sounds.die) : null;
    pointAudioRef.current = sounds.point ? new Audio(sounds.point) : null;
    // The boss's effect, from its fixed mp3 rather than the wav profile.
    fireballAudioRef.current = new Audio(fireballSound);

    // These are short game effects, so they shouldn't need to loop.
    if (jumpAudioRef.current) jumpAudioRef.current.preload = "auto";
    if (dieAudioRef.current) dieAudioRef.current.preload = "auto";
    if (pointAudioRef.current) {
      pointAudioRef.current.preload = "auto";
      // Cut point audio volume by half
      pointAudioRef.current.volume = 0.4;
    }
    if (fireballAudioRef.current) {
      fireballAudioRef.current.preload = "auto";
      fireballAudioRef.current.volume = 0.6;
    }

    return () => {
      jumpAudioRef.current = null;
      dieAudioRef.current = null;
      pointAudioRef.current = null;
      fireballAudioRef.current = null;
    };
  }, [soundProfile]);

  const playSound = useCallback((audioRef) => {
    // The effects switch gates every one-shot: jump, die, point and the boss's fireball.
    if (sfxMutedRef.current) return;

    const audio = audioRef.current;

    if (!audio) return;

    audio.currentTime = 0;

    // Browsers can reject playback if their autoplay policy
    // hasn't been satisfied. The game controls are user-driven,
    // so this should normally resolve successfully.
    audio.play().catch(() => {});
    // The ref is stable, so naming it keeps the lint rule happy without re-making the callback.
  }, [sfxMutedRef]);

  // Switches the music to `track`, or does nothing when it is already playing. The element is built on
  // demand, so only the tracks a run actually reaches are fetched, and it loops.
  const playMusic = useCallback((track) => {
    if (musicTrackRef.current === track) return;

    const current = musicAudioRef.current;
    if (current) {
      current.pause();
      current.currentTime = 0;
    }

    musicTrackRef.current = track;
    const source = MUSIC_SOURCES[track];
    if (!source) {
      musicAudioRef.current = null;
      return;
    }

    const audio = new Audio(source);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = MUSIC_VOLUME;
    musicAudioRef.current = audio;
    // Browsers block playback until the page has been interacted with. The catch keeps that silent
    // rather than fatal; the next press - or the mute switch - starts it.
    if (!musicMutedRef.current) audio.play().catch(() => {});
    // The ref is stable, so naming it keeps the lint rule happy without re-making the callback.
  }, [musicMutedRef]);

  const [gameState, setGameState] = useState("ready");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  // Leaderboard: the rows, plus a status so the panel can say "loading" or "unavailable"
  // instead of rendering an empty list that looks like nobody has ever played.
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardTotal, setLeaderboardTotal] = useState(0);
  const [boardStatus, setBoardStatus] = useState("loading");
  // What happened to the run that just ended: a new personal best, a score that did not beat
  // the existing one, or a failed save.
  const [savedNotice, setSavedNotice] = useState(null);
  const [view, setView] = useState({
    player: null,
    obstacles: [],
    particles: [],
    fireballs: [],
    boss: null,
    animation: "idle",
    frame: 0,
  });

  const groundY = height - GROUND_HEIGHT;

  // The play area the level clock needs, plus the chief's drawn size, the two durations, and the lines he may say.
  // Memoised so the loop's effect, which reads it every frame, does not re-subscribe on every render - which is also why
  // bossSayings has to be a stable array (see the prop above).
  const levelBounds = useMemo(
    () => ({
      width,
      height,
      groundY,
      chiefSize: CHIEF_DISPLAY_SIZE,
      interval: BOSS_INTERVAL_SECONDS,
      duration: BOSS_DURATION_SECONDS,
      sayings: bossSayings,
    }),
    [width, height, groundY, bossSayings]
  );

  const makePlayer = useCallback(
    () => ({
      x: 62,
      y: groundY - PLAYER_SPRITE_SIZE,
      width: PLAYER_SPRITE_SIZE,
      height: PLAYER_SPRITE_SIZE,
      velocityY: 0,
      grounded: true,
      ducking: false,
      dead: false,
    }),
    [groundY]
  );

  const resetGame = useCallback(() => {
    playerRef.current = makePlayer();
    obstaclesRef.current = [];
    particlesRef.current = [];
    spawnTimerRef.current = 0.85;
    distanceRef.current = 0;
    scoreRef.current = 0;
    animationStateRef.current = { name: "idle", frame: 0, timer: 0 };
    diePlayedRef.current = false;
    dyingRef.current = false;
    fireballsRef.current = [];
    // A new run starts in normal play, at the base speed, with no boss cycle behind it.
    levelRef.current = createLevel();

    setScore(0);
    setView({
      player: { ...playerRef.current },
      obstacles: [],
      particles: [],
      fireballs: [],
      boss: null,
      animation: "idle",
      frame: 0,
    });
  }, [makePlayer]);

  // Remembers a personal best locally. The server now keeps the authoritative copy, so this
  // is what the HUD shows immediately and what survives a backend that cannot be reached.
  const rememberBest = useCallback((value) => {
    const best = Number(value) || 0;
    if (best <= highScoreRef.current) return;
    highScoreRef.current = best;
    setHighScore(best);
    try {
      localStorage.setItem("firefighter-runner-high-score", String(best));
    } catch {
      /* storage unavailable - the score still shows for this session */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = Number(localStorage.getItem("firefighter-runner-high-score")) || 0;
    highScoreRef.current = saved;
    setHighScore(saved);
  }, []);

  // Loads the station board. A failure is not an error state for the game - the panel says
  // so and play carries on - so nothing here throws.
  const loadLeaderboard = useCallback(async () => {
    if (!token) {
      setBoardStatus("unavailable");
      return;
    }
    try {
      const data = await fetchRunnerLeaderboard(token);
      if (!data || !Array.isArray(data.leaderboard)) {
        setBoardStatus("unavailable");
        return;
      }
      setLeaderboard(data.leaderboard);
      setLeaderboardTotal(Number(data.total) || data.leaderboard.length);
      setBoardStatus("ready");
      // A best follows the member between devices, so the HUD picks up the server's number
      // when it beats whatever this browser happens to remember.
      const mine = data.leaderboard.find(
        (row) => currentUser && String(row.id) === String(currentUser.id)
      );
      if (mine) rememberBest(mine.score);
    } catch (err) {
      console.error("Runner leaderboard unavailable", err);
      setBoardStatus("unavailable");
    }
  }, [token, currentUser, rememberBest]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  // Records a finished run, then refreshes the board so the player sees where they landed.
  // The backend keeps the higher score, so calling this after every game is safe.
  const submitScore = useCallback(
    async (finalScore) => {
      if (!token || !(finalScore > 0)) return;
      try {
        const result = await saveRunnerScore(finalScore, token);
        if (!result || !result.success) {
          setSavedNotice({ kind: "failed" });
          return;
        }
        rememberBest(result.best);
        setSavedNotice(
          result.improved
            ? { kind: "improved", best: result.best }
            : { kind: "kept", best: result.best }
        );
        await loadLeaderboard();
      } catch (err) {
        console.error("Could not save the runner score", err);
        setSavedNotice({ kind: "failed" });
      }
    },
    [token, rememberBest, loadLeaderboard]
  );

  const startOrJump = useCallback(() => {
    if (gameState === "ready" || gameState === "gameover") {
      resetGame();
      // A new run starts clean, so last run's save notice is cleared with it.
      setSavedNotice(null);
      setGameState("playing");
      return;
    }

    const player = playerRef.current;
    if (!player || player.dead) return;

    if (player.grounded && !player.ducking) {
      player.velocityY = JUMP_VELOCITY;
      player.grounded = false;
      playSound(jumpAudioRef);
    }
  }, [gameState, resetGame, playSound]);

  // Admin-only debug: jump straight into the boss scene. From the ready or game-over screen it also
  // starts a run, so the boss is playable the moment it is clicked. `startBoss` is the module's own
  // function - the same one the schedule uses when the interval elapses - so it arrives as it really does.
  const skipToBoss = useCallback(() => {
    if (gameState !== "playing") {
      resetGame();
      setSavedNotice(null);
      setGameState("playing");
    }
    startBoss(levelRef.current, levelBounds);
  }, [gameState, resetGame, levelBounds]);

  const setDuck = useCallback(
    (isDucking) => {
      if (gameState !== "playing") return;

      const player = playerRef.current;
      if (!player || player.dead) return;

      // Ducking changes the animation and collision box,
      // but NEVER changes the sprite's position or dimensions.
      if (isDucking) {
        player.ducking = true;
      } else {
        player.ducking = false;
      }
    },
    [gameState]
  );

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.code === "ArrowDown") {
        event.preventDefault();
        setDuck(true);
        return;
      }

      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        startOrJump();
      }
    }

    function handleKeyUp(event) {
      if (event.code === "ArrowDown") {
        event.preventDefault();
        setDuck(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [setDuck, startOrJump]);

  // The fatal collision. The run ends here, but the loop does not: the firefighter still has to fall
  // to the ground and play its four death frames, so this only turns the player dead and lets the
  // loop's dying path take it from there.
  const startDying = useCallback(() => {
    if (gameState !== "playing" || dyingRef.current) return;

    const player = playerRef.current;
    player.dead = true;
    player.ducking = false;
    dyingRef.current = true;
    // Straight to the first death frame. A duck in progress otherwise stands the player back up first,
    // because its frames play out before the animation state is asked what to do next.
    animationStateRef.current = { name: "dead", frame: 0, timer: 0 };

    if (!diePlayedRef.current) {
      playSound(dieAudioRef);
      diePlayedRef.current = true;
    }
  }, [gameState, playSound]);

  // The end of the run itself: the score, the high score and the game-over screen. The loop calls it
  // once the death animation has played out, so the last frame is what stays on screen behind it.
  const endGame = useCallback(() => {
    if (gameState !== "playing") return;

    const finalScore = scoreRef.current;

    rememberBest(finalScore);

    setGameState("gameover");
    onGameOver?.(finalScore);
    // Fire-and-forget: submitScore reports its own failures in the leaderboard panel, so the
    // game never waits on the network to show the game-over screen.
    submitScore(finalScore);
  }, [gameState, onGameOver, rememberBest, submitScore]);

  useEffect(() => {
    if (gameState !== "playing") return undefined;

    function spawnObstacle() {
      const obstacles = obstaclesRef.current;
      const last = obstacles[obstacles.length - 1];

      if (last && last.x + last.width > width - 190) return;

      const flying =
        Math.random() < Math.min(0.22 + scoreRef.current / 1800, 0.55);

      if (flying) {
        // A helicopter, at one of its three hover heights, rotor already turning.
        const bottoms = HELI_BODY_BOTTOMS;
        const bottom = bottoms[Math.floor(Math.random() * bottoms.length)];

        obstacles.push({
          id: crypto.randomUUID(),
          type: "heli",
          x: width + 24,
          // Placed by where its body ends up, so the height the player has to clear is the height the
          // helicopter is drawn at - the sprite's own transparent margin does not come into it.
          y: groundY - bottom - (HELI_BODY.y + HELI_BODY.height) * HELI_SCALE,
          frame: 0,
          frameTimer: 0,
          width: HELI_DISPLAY_SIZE,
          height: HELI_DISPLAY_SIZE,
        });
      } else if (Math.random() < 0.5) {
        // Ground level, and as often as a hydrant: a firetruck parked in the road. Its own 64x40 SVG
        // drawn a fifth bigger again, which makes it the widest thing on the ground - the same jump,
        // just a longer one.
        obstacles.push({
          id: crypto.randomUUID(),
          type: "truck",
          x: width + 24,
          y: groundY - 48,
          width: 76.8,
          height: 48,
        });
      } else {
        obstacles.push({
          id: crypto.randomUUID(),
          type: "hydrant",
          x: width + 24,
          y: groundY - 44,
          width: 34,
          height: 44,
        });
      }
    }

    function spawnDust() {
      if (!playerRef.current?.grounded) return;

      particlesRef.current.push({
        id: crypto.randomUUID(),
        x: playerRef.current.x + 2,
        y: groundY - 5,
        vx: -30 - Math.random() * 45,
        vy: -8 - Math.random() * 25,
        life: 0.3,
      });
    }

    function updateAnimation(dt) {
      const player = playerRef.current;
      const state = animationStateRef.current;

      /*
       * DUCKING
       *
       * Press:
       *   duck1 → duck2 → [hold duck2]
       *
       * Release:
       *   duck3 → duck4 → normal animation
       */
      if (player.ducking && player.grounded) {
        if (state.name !== "duck") {
          state.name = "duck";
          state.frame = 0;
          state.timer = 0;
        }

        state.timer += dt;

        if (state.frame === 0 && state.timer >= 0.10) {
          state.frame = 1;
          state.timer = 0;
        }

        // Frame 1 (duck2) intentionally holds forever.
        return;
      }

      /*
       * If duck was released while we were in duck2,
       * start the stand-up animation.
       */
      if (state.name === "duck" && state.frame === 1) {
        state.timer += dt;

        if (state.timer >= 0.10) {
          state.frame = 2;
          state.timer = 0;
        }

        return;
      }

      /*
       * Finish duck3 → duck4.
       */
      if (state.name === "duck" && state.frame === 2) {
        state.timer += dt;

        if (state.timer >= 0.10) {
          state.frame = 3;
          state.timer = 0;
        }

        return;
      }

      /*
       * duck4 has finished.
       */
      if (state.name === "duck" && state.frame === 3) {
        state.timer += dt;

        if (state.timer >= 0.10) {
          state.name = getAnimation(player);
          state.frame = 0;
          state.timer = 0;
        }

        return;
      }

      /*
       * Normal animations.
       */
      const desiredAnimation = getAnimation(player);

      if (desiredAnimation !== state.name) {
        state.name = desiredAnimation;
        state.frame = 0;
        state.timer = 0;
      }

      const frameDurations = {
        idle: 0.42,
        run: 0.105,
        jump: 0.12,
        fall: 0.18,
        dead: 0.16,
      };

      state.timer += dt;

      if (state.timer >= frameDurations[desiredAnimation]) {
        state.timer -= frameDurations[desiredAnimation];

        const frames = SPRITES[desiredAnimation];

        if (desiredAnimation === "dead") {
          state.frame = Math.min(
            state.frame + 1,
            frames.length - 1
          );
        } else {
          state.frame =
            (state.frame + 1) % frames.length;
        }
      }
    }

    function frame(timestamp) {
      const previous = lastTimeRef.current || timestamp;
      const dt = Math.min((timestamp - previous) / 1000, 0.05);
      lastTimeRef.current = timestamp;

      const player = playerRef.current;

      // The run is over, but the loop is not: the firefighter has four death frames to play and, if it
      // died in the air, a fall to finish. Nothing else in the run moves - no level clock, no
      // obstacles, no fireballs, no score.
      if (dyingRef.current) {
        if (!player.grounded) {
          player.velocityY += GRAVITY * dt;
          player.y += player.velocityY * dt;

          const floorY = groundY - PLAYER_SPRITE_SIZE;

          if (player.y >= floorY) {
            player.y = floorY;
            player.velocityY = 0;
            player.grounded = true;
          }
        }

        updateAnimation(dt);

        const dyingAnimation = animationStateRef.current;
        setView((current) => ({
          ...current,
          player: { ...player },
          animation: dyingAnimation.name,
          frame: dyingAnimation.frame,
        }));

        // The last death frame, on the ground: that is the picture the game-over screen steps over.
        // Ending the run tears this effect down, and the loop with it.
        if (
          dyingAnimation.name === "dead" &&
          dyingAnimation.frame >= SPRITES.dead.length - 1 &&
          player.grounded
        ) {
          endGame();
          return;
        }

        animationRef.current = requestAnimationFrame(frame);
        return;
      }

      // The run's own speed, and the same speed stepped by the boss-cycle multiplier. Distance (and
      // so the score) follows the base, so a cycle raises what flies at you but not the score.
      const level = levelRef.current;
      const baseSpeed = Math.min(maxSpeed, initialSpeed + scoreRef.current * 2.8);
      const speed = baseSpeed * level.speed;

      // The level clock. utils/runnerLevel decides when the chief comes, fires and goes; the two
      // events back here are the things that need this loop's own state.
      for (const event of stepLevel(level, dt, levelBounds)) {
        if (event.type === "fireball") {
          fireballsRef.current.push({
            id: crypto.randomUUID(),
            // `event` is where the FLAME goes; the sprite is drawn so the flame lands there.
            x: event.x - FIREBALL_FLAME.x,
            y: event.y - FIREBALL_FLAME.y,
            frame: 0,
            frameTimer: 0,
          });
          playSound(fireballAudioRef);
        } else if (event.type === "boss-ended") {
          spawnTimerRef.current = 1; // a beat before the obstacles come back
        }
      }

      // The run's music: ordinary play or the boss, the two normal tracks alternating each cycle. The
      // menu screens are covered by their own effect, since this loop only runs while playing.
      playMusic(musicTrackFor({ playing: true, boss: !!level.chief, cycle: level.cycle }));

      if (player) {
        if (!player.grounded) {
          player.velocityY +=
            GRAVITY * dt * (player.ducking ? DUCK_FALL_MULTIPLIER : 1);

          player.y += player.velocityY * dt;

          const floorY = groundY - PLAYER_SPRITE_SIZE;

          if (player.y >= floorY) {
            player.y = floorY;
            player.velocityY = 0;
            player.grounded = true;
          }
        }

        // if (player.grounded && player.ducking) {
        //   player.y = groundY - player.height;
        // }
      }

      // Obstacles only during normal play: the boss level replaces them with fireballs.
      if (level.phase === "normal") {
        spawnTimerRef.current -= dt;

        if (spawnTimerRef.current <= 0) {
          spawnObstacle();

          const difficulty = Math.min(scoreRef.current / 900, 0.42);
          spawnTimerRef.current = 1.1 - difficulty + Math.random() * 0.55;
        }
      }

      for (const obstacle of obstaclesRef.current) {
        obstacle.x -= speed * dt;

        // The helicopter's rotor never stops. It is drawn from its own four-cell strip the way the
        // fireball is, so it carries a frame and its own timer.
        if (obstacle.type === "heli") {
          obstacle.frameTimer += dt;
          while (obstacle.frameTimer >= HELI_FRAME_SECONDS) {
            obstacle.frameTimer -= HELI_FRAME_SECONDS;
            obstacle.frame = (obstacle.frame + 1) % STRIP_FRAMES;
          }
        }
      }

      obstaclesRef.current = obstaclesRef.current.filter(
        (obstacle) => obstacle.x + obstacle.width > -40
      );

      // Fireballs: always animating, always heading left, gone once they are past the player.
      for (const fireball of fireballsRef.current) {
        fireball.x -= FIREBALL_SPEED * level.speed * dt;
        fireball.frameTimer += dt;
        while (fireball.frameTimer >= FIREBALL_FRAME_SECONDS) {
          fireball.frameTimer -= FIREBALL_FRAME_SECONDS;
          fireball.frame = (fireball.frame + 1) % STRIP_FRAMES;
        }
      }

      fireballsRef.current = fireballsRef.current.filter(
        (fireball) => fireball.x + FIREBALL_DISPLAY_SIZE > -20
      );

      for (const particle of particlesRef.current) {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.life -= dt;
      }

      particlesRef.current = particlesRef.current.filter(
        (particle) => particle.life > 0
      );

      distanceRef.current += baseSpeed * dt;

      const previousScore = scoreRef.current;
      const nextScore = Math.floor(distanceRef.current / 20);

      if (nextScore !== previousScore) {
        scoreRef.current = nextScore;
        setScore(nextScore);

        const previousMilestone = Math.floor(previousScore / SCORE_MILESTONE);
        const nextMilestone = Math.floor(nextScore / SCORE_MILESTONE);

        if (nextMilestone > previousMilestone) {
          playSound(pointAudioRef);
        }
      }

      if (Math.random() < 0.28) spawnDust();

      const hitbox = player.ducking
        ? PLAYER_DUCK_HITBOX
        : PLAYER_NORMAL_HITBOX;

      const playerHitbox = {
        x: player.x + hitbox.x,
        y: player.y + hitbox.y,
        width: hitbox.width,
        height: hitbox.height,
      };

      const hitObstacle = obstaclesRef.current.some((obstacle) => {
        // A sprite sheet's box is mostly transparent margin, so the helicopter is hit on the
        // helicopter, at the size it is drawn - the rule the fireball already follows with its flame.
        const box =
          obstacle.type === "heli"
            ? {
                x: obstacle.x + HELI_BODY.x * HELI_SCALE,
                y: obstacle.y + HELI_BODY.y * HELI_SCALE,
                width: HELI_BODY.width * HELI_SCALE,
                height: HELI_BODY.height * HELI_SCALE,
              }
            : {
                x: obstacle.x + 4,
                y: obstacle.y + 4,
                width: obstacle.width - 8,
                height: obstacle.height - 8,
              };

        return intersects(playerHitbox, box);
      });

      const hitFireball = fireballsRef.current.some((fireball) =>
        intersects(playerHitbox, {
          x: fireball.x + FIREBALL_FLAME.x,
          y: fireball.y + FIREBALL_FLAME.y,
          width: FIREBALL_FLAME.width,
          height: FIREBALL_FLAME.height,
        })
      );

      const collision = hitObstacle || hitFireball;

      if (collision) {
        startDying();
      }

      updateAnimation(dt);

      const animation = animationStateRef.current;

      const chief = levelRef.current.chief;
      setView({
        player: { ...player },
        obstacles: obstaclesRef.current.map((o) => ({ ...o })),
        particles: particlesRef.current.map((p) => ({ ...p })),
        fireballs: fireballsRef.current.map((f) => ({ ...f })),
        // The chief sits frozen on its right-most frame while fireSeq is -1, and plays 0..3 while
        // firing - one firing sequence per fireball. `saying` is whatever its bubble is showing right
        // now, or "" for a quiet gap (the timing lives in utils/runnerLevel).
        boss: chief ? { x: chief.x, y: chief.y, frame: chiefFrame(chief), saying: chief.saying } : null,
        animation: animation.name,
        frame: animation.frame,
      });

      // Always: a collision no longer stops the loop, it starts the death animation. What stops the
      // loop is the game-over screen replacing it, which the dying path above does.
      animationRef.current = requestAnimationFrame(frame);
    }

    lastTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(frame);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      animationRef.current = null;
      lastTimeRef.current = 0;
    };
  }, [
    endGame,
    gameState,
    groundY,
    height,
    initialSpeed,
    levelBounds,
    maxSpeed,
    width,
    playSound,
    playMusic,
    startDying,
  ]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  // The music on the screens either side of a run. While a run is on, the loop owns it.
  useEffect(() => {
    if (gameState === "playing") return;
    playMusic(musicTrackFor({ playing: false }));
  }, [gameState, playMusic]);

  // The music switch silences or resumes the track in hand. The sounds switch needs no effect of its
  // own: it only gates future one-shots, which playSound reads.
  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio) return;
    if (musicMuted) audio.pause();
    else audio.play().catch(() => {});
  }, [musicMuted]);

  // Leaving the game stops the music, so nothing plays on behind another screen.
  useEffect(
    () => () => {
      if (musicAudioRef.current) musicAudioRef.current.pause();
      musicAudioRef.current = null;
      musicTrackRef.current = null;
    },
    []
  );

  // THE STAGE, and the scale that fits the game into it.
  //
  // The runner is a fixed 800x280 world and the cabinet around it is responsive, so on a screen narrower than that the
  // world used to be CROPPED - and the first thing to go was the right-hand edge, which is where the chief holds
  // station. A phone showed a game with no boss in it, being shot at from off-screen. So the world is scaled to fit
  // instead (utils/runnerFit), and this measures the room it has.
  //
  // The STAGE is what gets measured, not the sky: the sky carries the transform, and a transformed element's own box
  // still reports its unscaled width - measuring it would read 800 for ever and never scale at all.
  const stageRef = useRef(null);
  const [fit, setFit] = useState(1);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;

    const measure = () => setFit(gameFit(node.clientWidth, width));
    measure();

    // No ResizeObserver - a test renderer, an old browser - is not a reason to leave the game cropped: the call above
    // has already measured what it could, and a window resize is the next best signal. In a renderer with no layout at
    // all the width reads 0, which gameFit answers with 1, so the harnesses draw the world at its own size.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);

  const player = view.player;
  const formattedScore = String(score).padStart(5, "0");
  const formattedHighScore = String(highScore).padStart(5, "0");

  return (
    <div
      className="ffr"
      // Opts the whole minigame out of the app-wide UI click sound (see utils/uiSounds). Its own jump/die/point
      // audio is deliberately untouched and stays exactly as it was; this only stops a UI click being layered
      // over it, since the whole cabinet is one big pointer surface with its own voice.
      data-sound="none"
      style={{
        "--ffr-width": `${width}px`,
        "--ffr-height": `${height}px`,
      }}
      role="application"
      aria-label="Firefighter endless runner"
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.focus();

        if (gameState === "playing") {
          startOrJump();
        } else {
          startOrJump();
        }
      }}
    >
      <div className="ffr__hud">
        {/* The controls sit at the far left; the scores keep their place on the right. The whole
            cabinet is a pointer surface, so a press on either must not also start a run or a jump. */}
        <div className="ffr__hud-tools">
          {isAdmin && (
            <button
              type="button"
              className="ffr__hud-button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={skipToBoss}
            >
              SKIP TO BOSS
            </button>
          )}
          <button
            type="button"
            className="ffr__hud-button"
            aria-pressed={musicMuted}
            aria-label={musicMuted ? "Unmute the music" : "Mute the music"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMusicMuted((muted) => !muted)}
          >
            {musicMuted ? "🔇 MUSIC OFF" : "🔊 MUSIC ON"}
          </button>
          <button
            type="button"
            className="ffr__hud-button"
            aria-pressed={sfxMuted}
            aria-label={sfxMuted ? "Unmute the game sounds" : "Mute the game sounds"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setSfxMuted((muted) => !muted)}
          >
            {sfxMuted ? "🔇 SOUNDS OFF" : "🔊 SOUNDS ON"}
          </button>
        </div>
        <span>HI {formattedHighScore}</span>
        <span>{formattedScore}</span>
      </div>

      {/* THE STAGE holds the game's fixed-size world at whatever scale fits the room the cabinet has. It is what the
          measurement watches, and its height is the SCALED height, so a narrow screen loses the empty space under the
          game rather than leaving a gap the size of the part that was cropped. See the fit effect above. */}
      <div
        className="ffr__stage"
        ref={stageRef}
        style={{ height: `${Math.round(height * fit)}px` }}
      >
        <div
          className="ffr__sky"
          style={{
            // translateZ(0) is in the stylesheet and has to be carried through here: an inline transform REPLACES the
            // CSS one, and that promotion is the WebKit compositing fix documented on .ffr__sky - without it Safari goes
            // back to re-clipping and re-compositing every sprite every frame, which is the stutter it was fixing.
            transform: `translateZ(0) scale(${fit})`,
            transformOrigin: "top left",
          }}
        >
        <div className="ffr__cloud ffr__cloud--one" />
        <div className="ffr__cloud ffr__cloud--two" />

        {view.particles.map((particle) => (
          <span
            key={particle.id}
            className="ffr__dust"
            style={{
              transform: `translate3d(${particle.x}px, ${particle.y}px, 0)`,
              opacity: Math.max(0, Math.min(1, particle.life / 0.3)),
            }}
          />
        ))}

        {view.obstacles.map((obstacle) => (
          <div
            key={obstacle.id}
            className={`ffr__obstacle ffr__obstacle--${obstacle.type}`}
            style={{
              transform: `translate3d(${obstacle.x}px, ${obstacle.y}px, 0)`,
            }}
          >
            {obstacle.type === "hydrant" && <HydrantSprite />}
            {obstacle.type === "truck" && <FireTruckSprite />}
            {obstacle.type === "heli" && (
              <StripSprite
                sheet={heliSheet}
                frame={obstacle.frame}
                displaySize={HELI_DISPLAY_SIZE}
              />
            )}
          </div>
        ))}

        {/* The chief and the fireballs it throws. Both sit in front of the ground but behind the
            player, and the fireball is always animating while the chief holds its last frame. */}
        {view.boss && (
          <div
            className="ffr__boss"
            style={{
              transform: `translate3d(${view.boss.x}px, ${view.boss.y}px, 0)`,
            }}
          >
            <StripSprite
              sheet={chiefSheet}
              frame={view.boss.frame}
              displaySize={CHIEF_DISPLAY_SIZE}
            />

            {/* THE CHIEF'S LINE, in a bubble beside the head. It has nothing to do with the game: it does not
                collide, it is not dodged, and nothing in the level waits for it. It is drawn here because this is
                where the chief is, and it comes and goes on its own - see the sayings in utils/runnerLevel. */}
            {view.boss.saying ? <div className="ffr__bubble">{view.boss.saying}</div> : null}
          </div>
        )}

        {view.fireballs.map((fireball) => (
          <div
            key={fireball.id}
            className="ffr__fireball"
            style={{
              transform: `translate3d(${fireball.x}px, ${fireball.y}px, 0)`,
            }}
          >
            <StripSprite
              sheet={fireballSheet}
              frame={fireball.frame}
              displaySize={FIREBALL_DISPLAY_SIZE}
            />
          </div>
        ))}

        {player && (
          <div
            className={`ffr__player ${player.ducking ? "ffr__player--ducking" : ""
              } ${!player.grounded ? "ffr__player--airborne" : ""}`}
            style={{
              transform: `translate3d(${player.x}px, ${player.y}px, 0)`,
            }}
          >
            <SpriteFrame
              animation={view.animation}
              frame={view.frame}
            />
          </div>
        )}

        <div className="ffr__ground">
          <div className="ffr__ground-lines" />
        </div>
      </div>

        {/* The overlay is OUTSIDE the sky, and so outside the scale: it is text, and text that shrinks with the game is
            text nobody can read on the phone this is for. It is positioned against the stage instead, which is why its
            bottom is set inline - the ground it sits above is 42 game pixels, and those are 42 * fit screen pixels. */}
        {(gameState === "ready" || gameState === "gameover") && (
          <div
            className="ffr__overlay"
            style={{ bottom: `${Math.round(GROUND_HEIGHT * fit)}px` }}
          >
            {gameState === "ready" ? (
              <>
                <div className="ffr__title">🚨 FIREHOUSE RUNNER</div>
                <div className="ffr__message">
                  SPACE / ↑ TO JUMP · ↓ TO DUCK
                </div>
                <div className="ffr__hint">CLICK TO RESPOND</div>
              </>
            ) : (
              <>
                <div className="ffr__title">🔥 FIRE&apos;S OUT!</div>
                <div className="ffr__message">
                  SCORE {formattedScore} · HI {formattedHighScore}
                </div>
                <div className="ffr__hint">
                  CLICK OR PRESS SPACE TO RUN AGAIN
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* TOUCH CONTROLS, for the device this is most likely played on. The keyboard the game was built around is not
          there, and tapping the screen is a poor substitute for a jump button: the same tap starts the run, and the
          thumb ends up over the thing it is trying to jump. The two pads sit BELOW the play area and above the
          leaderboard - out of the way of the game, and where the thumbs already rest.

          Shown only on a device that cannot hover (see the media query in the stylesheet), so on a desktop they are
          `display: none` and never in the tab order. And each one stops propagation, which is not optional: the whole
          cabinet is one pointer surface that jumps, so a tap here would otherwise jump twice. */}
      <div className="ffr__touch">
        <button
          type="button"
          className="ffr__touch-button ffr__touch-button--duck"
          aria-label="Duck"
          onPointerDown={(event) => {
            event.stopPropagation();
            // Captured, so the release always comes back here even if the thumb slides off the pad - which is what
            // makes holding to duck dependable rather than a way to get stuck bent double.
            event.currentTarget.setPointerCapture(event.pointerId);
            setDuck(true);
          }}
          onPointerUp={() => setDuck(false)}
          onPointerCancel={() => setDuck(false)}
          onLostPointerCapture={() => setDuck(false)}
        >
          <span className="ffr__touch-arrow">▼</span>
          DUCK
        </button>

        <button
          type="button"
          className="ffr__touch-button ffr__touch-button--jump"
          aria-label="Jump"
          onPointerDown={(event) => {
            event.stopPropagation();
            // The same call the keyboard and the whole-screen tap make, so this pad starts a run, restarts one after
            // a crash, and jumps mid-run, without any of that being a second implementation.
            startOrJump();
          }}
        >
          <span className="ffr__touch-arrow">▲</span>
          JUMP
        </button>
      </div>

      <div className="ffr__footer">
        <span>SPACE / ↑ = JUMP</span>
        <span>↓ = DUCK</span>
        <span>AVOID HYDRANTS, TRUCKS &amp; HELICOPTERS</span>
      </div>

      {/* Station leaderboard. The whole page is a start button, so a click in here must not
          kick off a run - hence the stopPropagation. */}
      <section
        className="ffr__board"
        aria-label="Station leaderboard"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="ffr__board-head">
          <span>🏆 STATION LEADERBOARD</span>
          <span>
            {boardStatus === "ready" && leaderboardTotal > 0
              ? `TOP ${leaderboard.length} OF ${leaderboardTotal}`
              : "PERSONAL BESTS"}
          </span>
        </div>

        {boardStatus === "loading" && (
          <p className="ffr__board-note">CHECKING THE BOARD…</p>
        )}

        {boardStatus === "unavailable" && (
          <p className="ffr__board-note">BOARD UNAVAILABLE RIGHT NOW</p>
        )}

        {boardStatus === "ready" && leaderboard.length === 0 && (
          <p className="ffr__board-note">NO SCORES YET — BE THE FIRST ON THE BOARD.</p>
        )}

        {leaderboard.length > 0 && (
          <ol className="ffr__board-list">
            {leaderboard.map((row, index) => {
              const isMe =
                currentUser && String(row.id) === String(currentUser.id);
              return (
                <li
                  key={row.id}
                  className={`ffr__board-row${isMe ? " ffr__board-row--me" : ""}`}
                >
                  <span className="ffr__board-rank">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="ffr__board-name">
                    {row.name || unnamedLabel('member')}
                    {isMe ? " (you)" : ""}
                  </span>
                  <span className="ffr__board-score">
                    {String(row.score).padStart(5, "0")}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {savedNotice?.kind === "improved" && (
          <p className="ffr__board-note ffr__board-note--ok">
            🏆 NEW PERSONAL BEST SAVED — {String(savedNotice.best).padStart(5, "0")}
          </p>
        )}
        {savedNotice?.kind === "kept" && (
          <p className="ffr__board-note">
            SCORE SENT · YOUR BEST IS STILL {String(savedNotice.best).padStart(5, "0")}
          </p>
        )}
        {savedNotice?.kind === "failed" && (
          <p className="ffr__board-note ffr__board-note--warn">
            COULD NOT SAVE YOUR SCORE
          </p>
        )}
      </section>
    </div>
  );
}
